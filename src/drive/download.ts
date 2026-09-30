import bigInt from 'big-integer'
import { Api, errors } from 'telegram'
import { storageChannel } from '../telegram/channel'
import { getClient } from '../telegram/client'
import { docRef } from '../telegram/messages'
import { isAndroid, phoneSaveTarget } from '../native/android'
import { CIPHER_BLOCK, decryptBlock, decryptThumb, fileKey } from './crypto'
import type { DocRef, FileItem, Part } from './tree'
import { applyMessages } from './sync'
import { TransferControl, withRetry } from './transfer'

/** Download request size (Telegram maximum; offsets stay 1 MB aligned). */
const REQUEST_SIZE = 1024 * 1024
const PARALLEL_REQUESTS = 4

/** Where downloaded bytes go. */
export interface SaveTarget {
  write(chunk: Uint8Array): Promise<void>
  close(): Promise<void>
  abort(): Promise<void>
}

/**
 * Ask where to save. Must be called directly from a click handler (browsers require a user gesture).
 * Returns null if the user dismissed the save dialog.
 */
export async function pickSaveTarget(file: FileItem): Promise<SaveTarget | null> {
  // The Android app saves straight into Downloads/TeleDrive
  if (isAndroid) return phoneSaveTarget(file.name, file.mime, 'downloads')
  const w = window as unknown as { showSaveFilePicker?: (o: object) => Promise<FileSystemFileHandleLike> }
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: file.name })
      const stream = await handle.createWritable()
      return {
        write: (c) => stream.write(c),
        close: () => stream.close(),
        abort: () => stream.abort(),
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null
      // Fall through to the in-memory download (e.g. picker blocked in an iframe)
    }
  }
  return memoryTarget(file)
}

/**
 * Ask where to save several files: one folder picker (Chrome/Edge), otherwise normal browser
 * downloads. Must be called directly from a click handler.
 */
export async function pickSaveTargets(files: FileItem[]): Promise<Map<string, SaveTarget> | null> {
  if (files.length === 1) {
    const t = await pickSaveTarget(files[0])
    return t ? new Map([[files[0].id, t]]) : null
  }
  const w = window as unknown as { showDirectoryPicker?: (o: object) => Promise<DirectoryHandleLike> }
  const targets = new Map<string, SaveTarget>()
  if (isAndroid) {
    for (const f of files) targets.set(f.id, phoneSaveTarget(f.name, f.mime, 'downloads'))
    return targets
  }
  if (w.showDirectoryPicker) {
    let dir: DirectoryHandleLike
    try {
      dir = await w.showDirectoryPicker({ mode: 'readwrite' })
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null
      for (const f of files) targets.set(f.id, memoryTarget(f))
      return targets
    }
    const used = new Set<string>()
    for (const f of files) {
      let name = f.name
      for (let n = 1; used.has(name.toLowerCase()); n++) {
        const dot = f.name.lastIndexOf('.')
        name = dot > 0 ? `${f.name.slice(0, dot)} (${n})${f.name.slice(dot)}` : `${f.name} (${n})`
      }
      used.add(name.toLowerCase())
      targets.set(f.id, lazyTarget(async () => (await dir.getFileHandle(name, { create: true })).createWritable()))
    }
    return targets
  }
  for (const f of files) targets.set(f.id, memoryTarget(f))
  return targets
}

interface DirectoryHandleLike {
  getFileHandle(name: string, o: { create: boolean }): Promise<FileSystemFileHandleLike>
}

type WritableLike = Awaited<ReturnType<FileSystemFileHandleLike['createWritable']>>

/** Opens the file only when the download actually starts. */
function lazyTarget(open: () => Promise<WritableLike>): SaveTarget {
  let stream: Promise<WritableLike> | null = null
  const get = () => (stream ??= open())
  return {
    write: async (c) => (await get()).write(c),
    close: async () => (await get()).close(),
    abort: async () => {
      if (stream) await (await stream).abort()
    },
  }
}

interface FileSystemFileHandleLike {
  createWritable(): Promise<{ write(c: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>
}

/** Collects the file in memory, then triggers a normal browser download. */
function memoryTarget(file: FileItem): SaveTarget {
  const parts: Uint8Array[] = []
  return {
    write: async (c) => {
      parts.push(c)
    },
    close: async () => {
      const url = URL.createObjectURL(new Blob(parts as BlobPart[], { type: file.mime }))
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    },
    abort: async () => {
      parts.length = 0
    },
  }
}

export async function downloadFile(file: FileItem, target: SaveTarget, ctl: TransferControl): Promise<void> {
  if (!file.complete) throw new Error('This file is incomplete (some parts are missing)')
  try {
    for (const i of file.parts.keys()) {
      for await (const bytes of readPart(file, i, ctl)) {
        await target.write(bytes)
        ctl.progress(bytes.length)
      }
    }
    await target.close()
  } catch (e) {
    await target.abort().catch(() => {})
    throw e
  }
}

/** Stream one part (Telegram document) in order, with a few requests in flight. Decrypts if needed. */
async function* readPart(file: FileItem, index: number, ctl: TransferControl): AsyncGenerator<Uint8Array> {
  const part = file.parts[index]
  if (!part.doc) throw new Error('Missing file data')
  const count = Math.ceil(part.doc.size / REQUEST_SIZE)
  const key = file.salt ? await fileKey(file.salt) : null
  // Encrypted blocks are numbered across the whole file
  const firstBlock = file.parts.slice(0, index).reduce((n, p) => n + (p.doc?.size ?? 0), 0) / CIPHER_BLOCK
  const inFlight = new Map<number, Promise<Uint8Array>>()
  let next = 0

  for (let i = 0; i < count; i++) {
    while (next < count && next < i + PARALLEL_REQUESTS) {
      const block = next++
      const p = ctl
        .checkpoint()
        .then(() => fetchBlock(part, block * REQUEST_SIZE))
        .then((bytes) => (key ? decryptBlock(key, firstBlock + block, bytes) : bytes))
      p.catch(() => {}) // handled when awaited below
      inFlight.set(block, p)
    }
    const bytes = await inFlight.get(i)!
    inFlight.delete(i)
    yield bytes
  }
}

/** One 1 MB block of a part. Refreshes the file reference once if it has expired. */
export async function fetchBlock(part: Part, offset: number, thumbSize = ''): Promise<Uint8Array> {
  if (!part.doc) throw new Error('Missing file data')
  try {
    return await getBlock(part.doc, offset, thumbSize)
  } catch (e) {
    if (!(e as { errorMessage?: string }).errorMessage?.startsWith('FILE_REFERENCE_')) throw e
    return getBlock(await refreshDoc(part), offset, thumbSize)
  }
}

export const BLOCK_SIZE = REQUEST_SIZE

/** Read a whole (small) file into memory, e.g. for previews. */
export async function readBlob(file: FileItem, ctl: TransferControl): Promise<Blob> {
  const chunks: Uint8Array[] = []
  for (const i of file.parts.keys()) {
    for await (const bytes of readPart(file, i, ctl)) {
      chunks.push(bytes)
      ctl.progress(bytes.length)
    }
  }
  return new Blob(chunks as BlobPart[], { type: file.mime })
}

/** Read the first bytes of a file (e.g. to preview a text file). */
export async function readHead(file: FileItem, maxBytes: number): Promise<Uint8Array> {
  const bytes = await fetchBlock(file.parts[0], 0)
  const plain = file.salt ? await decryptBlock(await fileKey(file.salt), 0, bytes) : bytes
  return plain.subarray(0, maxBytes)
}

/** Download the thumbnail Telegram stores with the file's first part, if any. */
export async function fetchThumbnail(file: FileItem): Promise<Blob | null> {
  // Encrypted files keep an encrypted thumbnail in its own message
  if (file.salt) {
    if (!file.thumbPart) return null
    return decryptThumb(await fileKey(file.salt), await fetchBlock(file.thumbPart, 0))
  }
  const part = file.parts[0]
  if (!part?.doc?.thumb) return null
  const bytes = await fetchBlock(part, 0, part.doc.thumb)
  return new Blob([bytes as BlobPart], { type: 'image/jpeg' })
}

async function getBlock(doc: DocRef, offset: number, thumbSize = ''): Promise<Uint8Array> {
  const client = await getClient()
  const location = new Api.InputDocumentFileLocation({
    id: bigInt(doc.docId),
    accessHash: bigInt(doc.accessHash),
    fileReference: Buffer.from(doc.fileRef),
    thumbSize,
  })
  const request = new Api.upload.GetFile({ location, offset: bigInt(offset), limit: REQUEST_SIZE, precise: false })
  let dcId = doc.dcId
  return withRetry(async () => {
    for (;;) {
      const sender = await client.getSender(dcId === client.session.dcId ? 0 : dcId)
      try {
        const res = await client.invokeWithSender(request, sender)
        if (!(res instanceof Api.upload.File)) throw new Error('CDN downloads are not supported')
        return new Uint8Array(res.bytes)
      } catch (e) {
        // The file lives in another data center: switch and try again
        if (e instanceof errors.FileMigrateError && e.newDc !== dcId) {
          dcId = e.newDc
          continue
        }
        throw e
      }
    }
  })
}

async function refreshDoc(part: Part): Promise<DocRef> {
  const client = await getClient()
  const res = await client.invoke(
    new Api.channels.GetMessages({ channel: storageChannel(), id: [new Api.InputMessageID({ id: part.msgId })] }),
  )
  const msg = 'messages' in res ? res.messages.find((m) => m.id === part.msgId) : undefined
  const doc = msg instanceof Api.Message ? docRef(msg) : undefined
  if (!msg || !doc) throw new Error('This file was deleted')
  await applyMessages([msg])
  part.doc = doc
  return doc
}
