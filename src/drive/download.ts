import bigInt from 'big-integer'
import { Api, errors } from 'telegram'
import { storageChannel } from '../telegram/channel'
import { getClient } from '../telegram/client'
import { docRef } from '../telegram/messages'
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
    for (const part of file.parts) {
      for await (const bytes of readPart(part, ctl)) {
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

/** Stream one part (Telegram document) in order, with a few requests in flight. */
async function* readPart(part: Part, ctl: TransferControl): AsyncGenerator<Uint8Array> {
  if (!part.doc) throw new Error('Missing file data')
  let doc = part.doc
  const count = Math.ceil(doc.size / REQUEST_SIZE)
  const inFlight = new Map<number, Promise<Uint8Array>>()
  let next = 0

  const fetchBlock = async (i: number): Promise<Uint8Array> => {
    await ctl.checkpoint()
    try {
      return await getBlock(doc, i * REQUEST_SIZE)
    } catch (e) {
      if (!(e as { errorMessage?: string }).errorMessage?.startsWith('FILE_REFERENCE_')) throw e
      // File references expire; refresh from the message and retry once
      doc = await refreshDoc(part)
      return getBlock(doc, i * REQUEST_SIZE)
    }
  }

  for (let i = 0; i < count; i++) {
    while (next < count && next < i + PARALLEL_REQUESTS) {
      const p = fetchBlock(next)
      p.catch(() => {}) // handled when awaited below
      inFlight.set(next++, p)
    }
    const bytes = await inFlight.get(i)!
    inFlight.delete(i)
    yield bytes
  }
}

async function getBlock(doc: DocRef, offset: number): Promise<Uint8Array> {
  const client = await getClient()
  const location = new Api.InputDocumentFileLocation({
    id: bigInt(doc.docId),
    accessHash: bigInt(doc.accessHash),
    fileReference: Buffer.from(doc.fileRef),
    thumbSize: '',
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
