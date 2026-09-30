import { nanoid } from 'nanoid'
import { Api } from 'telegram'
import { storageChannel, storagePeer } from '../telegram/channel'
import { getClient } from '../telegram/client'
import { messagesFromUpdates } from '../telegram/messages'
import { encode, type ChunkMeta, type FileMeta } from './meta'
import { applyMessages } from './sync'
import { randomLong, TransferControl, withRetry } from './transfer'

/** Upload request size (Telegram maximum). */
const PART_SIZE = 512 * 1024
/** Bytes per Telegram message. Telegram's per-file limit is 2 GB (4 GB with Premium). */
export const CHUNK_SIZE = 512 * 1024 * 1024
/** Files bigger than this must use upload.saveBigFilePart. */
const BIG_FILE_THRESHOLD = 10 * 1024 * 1024
const PARALLEL_PARTS = 4

export class EmptyFileError extends Error {
  constructor() {
    super("Empty files can't be stored on Telegram")
  }
}

/**
 * Upload a file into a folder. Extra chunks (2..N) are sent first and the main message (part 1)
 * last, so other devices only see the file once it is complete.
 */
export async function uploadFile(file: Blob, name: string, parentId: string, ctl: TransferControl): Promise<void> {
  if (file.size === 0) throw new EmptyFileError()
  const id = nanoid(10)
  const total = Math.ceil(file.size / CHUNK_SIZE)
  const mime = file.type || 'application/octet-stream'
  const meta: FileMeta = {
    td: 1, t: 'f', id, p: parentId, n: name, s: file.size, m: mime, of: total, ts: Math.floor(Date.now() / 1000),
  }
  const caption = encode(meta) // validate before uploading anything

  const sent: number[] = []
  try {
    for (const pt of [...Array.from({ length: total - 1 }, (_, i) => i + 2), 1]) {
      const blob = file.slice((pt - 1) * CHUNK_SIZE, pt * CHUNK_SIZE)
      const text = pt === 1 ? caption : encode({ td: 1, t: 'c', id, pt } satisfies ChunkMeta)
      const fileName = total === 1 ? name : `${name}.part${pt}`
      const inputFile = await uploadBlob(blob, fileName, ctl)
      await ctl.checkpoint()
      const msgs = await sendDocument(inputFile, fileName, pt === 1 ? mime : 'application/octet-stream', text, ctl)
      sent.push(...msgs.map((m) => m.id))
      await applyMessages(msgs)
    }
  } catch (e) {
    // Don't leave half-uploaded chunks behind
    if (sent.length) {
      const client = await getClient()
      await client
        .invoke(new Api.channels.DeleteMessages({ channel: storageChannel(), id: sent }))
        .catch(() => {})
    }
    throw e
  }
}

async function uploadBlob(blob: Blob, name: string, ctl: TransferControl): Promise<Api.TypeInputFile> {
  const client = await getClient()
  const fileId = randomLong()
  const big = blob.size > BIG_FILE_THRESHOLD
  const totalParts = Math.ceil(blob.size / PART_SIZE)
  let next = 0

  const worker = async () => {
    while (next < totalParts) {
      await ctl.checkpoint()
      const part = next++
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
      ctl.progress(bytes.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL_PARTS, totalParts) }, worker))

  return big
    ? new Api.InputFileBig({ id: fileId, parts: totalParts, name })
    : new Api.InputFile({ id: fileId, parts: totalParts, name, md5Checksum: '' })
}

async function sendDocument(
  file: Api.TypeInputFile, fileName: string, mimeType: string, caption: string, ctl: TransferControl,
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
