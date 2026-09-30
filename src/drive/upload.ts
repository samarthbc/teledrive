import bigInt from 'big-integer'
import { nanoid } from 'nanoid'
import { Api } from 'telegram'
import { db, type ChunkState, type UploadState } from '../db/db'
import { errorCode } from '../telegram/auth'
import { storageChannel, storagePeer } from '../telegram/channel'
import { getClient } from '../telegram/client'
import { messagesFromUpdates } from '../telegram/messages'
import { EncryptedSource, encryptThumb, fileKey, newFileSalt, seal } from './crypto'
import { sha256 } from './hash'
import { encode, type ChunkMeta, type FileMeta, type Secret } from './meta'
import { rememberSecret } from './secrets'
import { applyMessages, getRecord } from './sync'
import { makeThumbnail } from './thumbnail'
import { CanceledError, randomLong, TransferControl, withRetry } from './transfer'

/** Upload request size (Telegram maximum). */
const PART_SIZE = 512 * 1024
/** Bytes per Telegram message. Telegram's per-file limit is 2 GB (4 GB with Premium). */
export const CHUNK_SIZE = 512 * 1024 * 1024
/** Files bigger than this must use upload.saveBigFilePart. */
const BIG_FILE_THRESHOLD = 10 * 1024 * 1024
const PARALLEL_PARTS = 4
const SAVE_INTERVAL = 2000

/** Anything that can be read in slices: a browser Blob/File, or a file on the phone. */
export interface ByteSource {
  readonly size: number
  slice(start?: number, end?: number): ByteSource
  arrayBuffer(): Promise<ArrayBuffer>
}

/** A file to upload. Browser `File` objects fit this as-is. */
export interface UploadSource extends ByteSource {
  readonly name: string
  readonly type: string
  readonly lastModified: number
  /** Custom thumbnail (e.g. made by Android); otherwise one is generated in the browser. */
  thumbnail?(): Promise<Blob | null>
}

export class EmptyFileError extends Error {
  constructor() {
    super("Empty files can't be stored on Telegram")
  }
}

export interface UploadOptions {
  /** Encrypt the file (the drive has encryption on and is unlocked). */
  encrypt: boolean
  /** SHA-256 of the content (hex), if already computed. */
  hash?: string
}

export function uploadKey(file: UploadSource, parentId: string): string {
  return `${parentId}|${file.name}|${file.size}|${file.lastModified}`
}

/** An unfinished upload of this file into this folder, if there is one. */
export function findResumable(file: UploadSource, parentId: string): Promise<UploadState | undefined> {
  return db.uploads.get(uploadKey(file, parentId))
}

/**
 * Upload a file into a folder. Extra chunks (2..N) are sent first and the main message (part 1)
 * last, so other devices only see the file once it is complete.
 *
 * Progress is saved as it goes: if the upload fails (or the page is closed), uploading the same
 * file into the same folder again continues where it stopped. Canceling discards everything.
 */
export async function uploadFile(
  file: UploadSource, name: string, parentId: string, ctl: TransferControl, opts: UploadOptions,
): Promise<void> {
  if (file.size === 0) throw new EmptyFileError()
  const key = uploadKey(file, parentId)
  // A resumed upload keeps its original choice (its first chunks were sent that way)
  const state: UploadState = (await db.uploads.get(key)) ?? {
    key, id: nanoid(10), name, chunks: {}, updated: 0, ...(opts.encrypt && { salt: newFileSalt() }),
  }
  if (opts.hash) state.hash ??= opts.hash
  // The hash is stored with the file, so later uploads of the same content can be spotted
  if (!state.hash) {
    ctl.note('Checking file…')
    state.hash = await sha256(file, ctl, (done) => ctl.note(`Checking file… ${Math.floor((done / file.size) * 100)}%`))
    ctl.note()
  }
  const cryptoKey = state.salt ? await fileKey(state.salt) : null
  // What goes to Telegram: the file itself, or its encrypted form
  const src: ByteSource = cryptoKey ? new EncryptedSource(file, cryptoKey) : file
  const total = Math.ceil(src.size / CHUNK_SIZE)
  const mime = file.type || 'application/octet-stream'
  const caption = async () => {
    const ts = Math.floor(Date.now() / 1000)
    if (!state.salt)
      return encode({
        td: 1, t: 'f', id: state.id, p: parentId, n: state.name, s: file.size, m: mime, of: total, ts,
        ...(state.hash && { h: state.hash }),
      } satisfies FileMeta)
    const secret: Secret = { n: state.name, m: mime, ...(state.hash && { h: state.hash }) }
    const e = await seal(secret)
    rememberSecret(e, secret)
    return encode({
      td: 1, t: 'f', id: state.id, p: parentId, n: '', s: file.size, m: '', of: total, ts, x: { enc: 1 }, k: state.salt, e,
    } satisfies FileMeta)
  }
  await caption() // validate before uploading anything

  // Chunks sent earlier may have been deleted since (e.g. by the cleanup of old leftovers)
  for (const [pt, cs] of Object.entries(state.chunks)) {
    const r = cs.msgId ? getRecord(cs.msgId) : undefined
    if (cs.msgId && !(r?.meta.t === 'c' && r.meta.id === state.id && r.meta.pt === Number(pt))) delete cs.msgId
  }

  let lastSave = 0
  const save = async (force = false) => {
    if (!force && Date.now() - lastSave < SAVE_INTERVAL) return
    lastSave = Date.now()
    state.updated = lastSave
    await db.uploads.put(state)
  }

  // Encrypted files don't reveal their name to Telegram
  const baseName = cryptoKey ? `${state.id}.bin` : state.name

  try {
    // Encrypted files: the encrypted thumbnail (part 0) is sent before the main message
    const order = [...Array.from({ length: total - 1 }, (_, i) => i + 2), ...(cryptoKey ? [0] : []), 1]
    for (const pt of order) {
      if (pt === 0) {
        await sendEncryptedThumb(file, mime, cryptoKey!, state.id, (state.chunks[0] ??= {}), ctl)
        await save(true)
        continue
      }
      const blob = src.slice((pt - 1) * CHUNK_SIZE, pt * CHUNK_SIZE)
      const cs = (state.chunks[pt] ??= {})
      if (cs.msgId) {
        ctl.progress(blob.size)
        continue
      }
      const fileName = total === 1 ? baseName : `${baseName}.part${pt}`
      const isMain = pt === 1
      // Encrypted files get their (encrypted) thumbnail separately
      const thumb = isMain && !cryptoKey ? await thumbnailFor(file, mime) : null

      const msgs = await sendWithRepair(ctl, blob, fileName, cs, save, async (inputFile) => {
        const thumbFile = thumb ? await uploadSmall(thumb, 'thumb.jpg') : undefined
        return sendDocument(
          inputFile, thumbFile, fileName, isMain && !cryptoKey ? mime : 'application/octet-stream',
          isMain ? await caption() : encode({ td: 1, t: 'c', id: state.id, pt } satisfies ChunkMeta), ctl,
        )
      })
      cs.msgId = msgs[0].id
      delete cs.tgFileId
      delete cs.done
      await save(true)
      await applyMessages(msgs)
    }
    await db.uploads.delete(key)
  } catch (e) {
    if (e instanceof CanceledError || ctl.canceled) {
      await discard(state)
    } else {
      await save(true)
    }
    throw e
  }
}

/** Encrypted files: send the thumbnail, encrypted, as its own message (part 0). */
async function sendEncryptedThumb(
  file: UploadSource, mime: string, key: CryptoKey, id: string, cs: ChunkState, ctl: TransferControl,
): Promise<void> {
  if (cs.msgId) return
  const thumb = await thumbnailFor(file, mime)
  if (!thumb) return
  const inputFile = await uploadSmall(await encryptThumb(key, thumb), `${id}.thumb`)
  const msgs = await sendDocument(
    inputFile, undefined, `${id}.thumb`, 'application/octet-stream',
    encode({ td: 1, t: 'c', id, pt: 0 } satisfies ChunkMeta), ctl,
  )
  cs.msgId = msgs[0].id
  await applyMessages(msgs)
}

async function thumbnailFor(file: UploadSource, mime: string): Promise<Blob | null> {
  if (file.thumbnail) return file.thumbnail().catch(() => null)
  return file instanceof Blob ? makeThumbnail(file, mime) : null
}

/** Delete an unfinished upload's saved progress and any chunks it already sent. */
export async function discard(state: UploadState): Promise<void> {
  const sent = Object.values(state.chunks).flatMap((c) => (c.msgId ? [c.msgId] : []))
  if (sent.length) {
    const client = await getClient()
    await client.invoke(new Api.channels.DeleteMessages({ channel: storageChannel(), id: sent })).catch(() => {})
  }
  await db.uploads.delete(state.key)
}

/**
 * Upload a chunk's bytes, then send it. Telegram only keeps uploaded parts for a limited time, so if
 * a resumed upload's parts have expired, upload the chunk again from scratch (once).
 */
async function sendWithRepair(
  ctl: TransferControl, blob: ByteSource, name: string, cs: ChunkState, save: () => Promise<void>,
  send: (file: Api.TypeInputFile) => Promise<Api.Message[]>,
): Promise<Api.Message[]> {
  for (let attempt = 1; ; attempt++) {
    const credited = { bytes: 0 }
    const inputFile = await uploadParts(blob, name, cs, ctl, save, credited)
    await ctl.checkpoint()
    try {
      return await send(inputFile)
    } catch (e) {
      const code = errorCode(e)
      const expired = code.startsWith('FILE_PART') || code === 'FILE_PARTS_INVALID'
      if (!expired || attempt > 1) throw e
      ctl.progress(-credited.bytes)
      delete cs.tgFileId
      delete cs.done
    }
  }
}

async function uploadParts(
  blob: ByteSource, name: string, cs: ChunkState, ctl: TransferControl, save: () => Promise<void>,
  credited: { bytes: number },
): Promise<Api.TypeInputFile> {
  const client = await getClient()
  cs.tgFileId ??= randomLong().toString()
  const fileId = bigInt(cs.tgFileId)
  const big = blob.size > BIG_FILE_THRESHOLD
  const totalParts = Math.ceil(blob.size / PART_SIZE)
  const done = new Set(cs.done ?? [])
  cs.done = [...done]
  const partBytes = (i: number) => Math.min(PART_SIZE, blob.size - i * PART_SIZE)

  // Parts uploaded before a resume count as progress straight away
  for (const i of done) {
    ctl.progress(partBytes(i))
    credited.bytes += partBytes(i)
  }

  const todo = Array.from({ length: totalParts }, (_, i) => i).filter((i) => !done.has(i))
  let next = 0
  const worker = async () => {
    while (next < todo.length) {
      await ctl.checkpoint()
      const part = todo[next++]
      const bytes = Buffer.from(await blob.slice(part * PART_SIZE, (part + 1) * PART_SIZE).arrayBuffer())
      await withRetry(
        () =>
          client.invoke(
            big
              ? new Api.upload.SaveBigFilePart({ fileId, filePart: part, fileTotalParts: totalParts, bytes })
              : new Api.upload.SaveFilePart({ fileId, filePart: part, bytes }),
          ),
        ctl,
      )
      cs.done!.push(part)
      ctl.progress(bytes.length)
      credited.bytes += bytes.length
      await save()
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL_PARTS, todo.length) }, worker))

  return big
    ? new Api.InputFileBig({ id: fileId, parts: totalParts, name })
    : new Api.InputFile({ id: fileId, parts: totalParts, name, md5Checksum: '' })
}

/** Upload a small file (e.g. a thumbnail) in one go. */
async function uploadSmall(blob: Blob, name: string): Promise<Api.TypeInputFile> {
  const client = await getClient()
  const id = randomLong()
  const parts = Math.ceil(blob.size / PART_SIZE)
  for (let i = 0; i < parts; i++) {
    const bytes = Buffer.from(await blob.slice(i * PART_SIZE, (i + 1) * PART_SIZE).arrayBuffer())
    await withRetry(() => client.invoke(new Api.upload.SaveFilePart({ fileId: id, filePart: i, bytes })))
  }
  return new Api.InputFile({ id, parts, name, md5Checksum: '' })
}

async function sendDocument(
  file: Api.TypeInputFile, thumb: Api.TypeInputFile | undefined, fileName: string, mimeType: string,
  caption: string, ctl: TransferControl,
): Promise<Api.Message[]> {
  const client = await getClient()
  // Same randomId on every retry, so Telegram won't post the message twice
  const randomId = randomLong()
  const res = await withRetry(
    () =>
      client.invoke(
        new Api.messages.SendMedia({
          peer: storagePeer(),
          media: new Api.InputMediaUploadedDocument({
            file,
            thumb,
            mimeType,
            attributes: [new Api.DocumentAttributeFilename({ fileName })],
            forceFile: true,
          }),
          message: caption,
          randomId,
          silent: true,
        }),
      ),
    ctl,
  )
  const msgs = messagesFromUpdates(res)
  if (!msgs.length) throw new Error('Upload finished but Telegram returned no message')
  return msgs
}
