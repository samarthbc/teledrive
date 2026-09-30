import { driveDb } from '../db/db'
import { fetchThumbnail } from './download'
import type { FileItem } from './tree'

const MAX_PARALLEL = 3

const urls = new Map<string, string>()
const pending = new Map<string, Promise<string | null>>()
let active = 0
const waiting: (() => void)[] = []

export function hasThumbnail(file: FileItem): boolean {
  if (file.salt) return !file.locked && !!file.thumbPart
  return !!file.parts[0]?.doc?.thumb
}

/** Object URL of the file's thumbnail: from memory, then IndexedDB, then Telegram. */
export function thumbnailUrl(file: FileItem): Promise<string | null> {
  const known = urls.get(file.id)
  if (known) return Promise.resolve(known)
  if (!hasThumbnail(file)) return Promise.resolve(null)
  let p = pending.get(file.id)
  if (!p) {
    p = load(file).finally(() => pending.delete(file.id))
    pending.set(file.id, p)
  }
  return p
}

async function load(file: FileItem): Promise<string | null> {
  // Thumbnails of encrypted files are kept in memory only, never saved decrypted
  let blob = file.salt ? undefined : (await driveDb().thumbs.get(file.id))?.blob
  if (!blob) {
    blob = (await limited(() => fetchThumbnail(file).catch(() => null))) ?? undefined
    if (!blob) return null
    if (!file.salt) await driveDb().thumbs.put({ id: file.id, blob })
  }
  const url = URL.createObjectURL(blob)
  urls.set(file.id, url)
  return url
}

async function limited<T>(fn: () => Promise<T>): Promise<T> {
  while (active >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r))
  active++
  try {
    return await fn()
  } finally {
    active--
    waiting.shift()?.()
  }
}
