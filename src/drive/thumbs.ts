import { driveDb } from '../db/db'
import { isLevelOpen, onKeysChanged, ROOT_LEVEL } from './keyring'
import { fetchThumbnail } from './download'
import type { FileItem } from './tree'

const MAX_PARALLEL = 3

const urls = new Map<string, string>()
/** Thumbnails of locked items: forgotten as soon as their lock closes. */
const lockedUrls = new Map<string, string>()
onKeysChanged(() => {
  for (const [id, level] of lockedUrls) {
    if (isLevelOpen(level)) continue
    URL.revokeObjectURL(urls.get(id)!)
    urls.delete(id)
    lockedUrls.delete(id)
  }
})
const pending = new Map<string, Promise<string | null>>()
let active = 0
const waiting: (() => void)[] = []

export function hasThumbnail(file: FileItem): boolean {
  if (file.fileKey) return !file.locked && !!file.thumbPart
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
  // Thumbnails of locked items (and what's inside locked folders) stay in memory only, never saved decrypted
  const keep = file.level === ROOT_LEVEL
  let blob = keep ? (await driveDb().thumbs.get(file.id))?.blob : undefined
  if (!blob) {
    blob = (await limited(() => fetchThumbnail(file).catch(() => null))) ?? undefined
    if (!blob) return null
    if (keep) await driveDb().thumbs.put({ id: file.id, blob })
  }
  const url = URL.createObjectURL(blob)
  urls.set(file.id, url)
  if (!keep) lockedUrls.set(file.id, file.level)
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
