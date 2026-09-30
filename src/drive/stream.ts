import { decryptBlock, fileKey, PLAIN_BLOCK } from './crypto'
import { BLOCK_SIZE, fetchBlock } from './download'
import type { FileItem } from './tree'

// Page side of streaming (see public/sw.js). The service worker forwards media Range requests here;
// we answer with up to MAX_REPLY bytes and prefetch the next blocks so playback stays smooth.

const MAX_REPLY = 2 * 1024 * 1024
const PREFETCH = 3
const CACHE_BLOCKS = 48

const BASE = import.meta.env.BASE_URL
const cache = new Map<string, Promise<Uint8Array>>()
let getFile: (id: string) => FileItem | undefined = () => undefined

export function initStreaming(lookup: (id: string) => FileItem | undefined): void {
  getFile = lookup
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.addEventListener('message', onMessage)
  navigator.serviceWorker.register(`${BASE}sw.js`, { scope: BASE }).catch((e) => {
    console.warn('Streaming unavailable: service worker failed to register', e)
  })
}

/** True once the service worker controls this page (the first visit needs it to activate). */
export function canStream(): boolean {
  return !!navigator.serviceWorker?.controller
}

export function streamUrl(file: FileItem): string {
  return `${BASE}stream/${encodeURIComponent(file.id)}/${encodeURIComponent(file.name)}`
}

interface StreamRequest {
  type: 'td-stream'
  id: string
  start: number
  end?: number
}

async function onMessage(e: MessageEvent) {
  const req = e.data as StreamRequest
  if (req?.type !== 'td-stream') return
  const port = e.ports[0]
  const file = getFile(req.id)
  if (!file || !file.complete) return port.postMessage({ ok: false, status: 404, error: 'File not found' })
  if (req.start >= file.size) return port.postMessage({ ok: false, status: 416, error: 'Range not satisfiable' })
  try {
    const bytes = await readRange(file, req.start, req.end)
    port.postMessage({ ok: true, bytes, start: req.start, size: file.size, mime: file.mime }, [bytes.buffer])
  } catch (err) {
    port.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}

/** Bytes from `start` up to `end` (inclusive), capped at MAX_REPLY. */
export async function readRange(file: FileItem, start: number, end?: number): Promise<Uint8Array> {
  // Encrypted files: each 1 MB block on Telegram holds slightly less than 1 MB of the file
  const bs = file.salt ? PLAIN_BLOCK : BLOCK_SIZE
  const last = Math.min(end ?? Infinity, start + MAX_REPLY - 1, file.size - 1)
  const firstBlock = Math.floor(start / bs)
  const lastBlock = Math.floor(last / bs)
  const blocks = await Promise.all(range(firstBlock, lastBlock).map((b) => block(file, b)))

  const totalBlocks = Math.ceil(file.size / bs)
  for (const b of range(lastBlock + 1, Math.min(lastBlock + PREFETCH, totalBlocks - 1))) {
    block(file, b).catch(() => {})
  }

  const out = new Uint8Array(last - start + 1)
  let offset = 0
  for (const [i, bytes] of blocks.entries()) {
    const from = i === 0 ? start - firstBlock * bs : 0
    const slice = bytes.subarray(from, Math.min(bytes.length, from + out.length - offset))
    out.set(slice, offset)
    offset += slice.length
  }
  return out
}

/** A block of the file (1 MB on Telegram), located across its parts, decrypted if needed (cached, LRU). */
function block(file: FileItem, index: number): Promise<Uint8Array> {
  const key = `${file.id}:${index}`
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  let offset = index * BLOCK_SIZE
  let part = file.parts[0]
  for (const p of file.parts) {
    part = p
    const size = p.doc?.size ?? 0
    if (offset < size) break
    offset -= size
  }
  const p = file.salt
    ? Promise.all([fetchBlock(part, offset), fileKey(file.salt)]).then(([bytes, k]) => decryptBlock(k, index, bytes))
    : fetchBlock(part, offset)
  cache.set(key, p)
  p.catch(() => cache.delete(key))
  while (cache.size > CACHE_BLOCKS) cache.delete(cache.keys().next().value!)
  return p
}

function range(from: number, to: number): number[] {
  return to < from ? [] : Array.from({ length: to - from + 1 }, (_, i) => from + i)
}
