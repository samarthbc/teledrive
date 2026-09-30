import type { EncryptionConfig } from './crypto'
import { ROOT, type Flags, type Meta, type Secret } from './meta'

/** Where a Telegram document lives; enough to download it without re-fetching the message. */
export interface DocRef {
  docId: string
  accessHash: string
  fileRef: Uint8Array
  dcId: number
  size: number
  /** Thumbnail size type (e.g. "m"), if Telegram has a thumbnail for this document. */
  thumb?: string
}

/** One channel message, parsed. Stored in IndexedDB. */
export interface MessageRecord {
  msgId: number
  meta: Meta
  doc?: DocRef
  date: number
}

export interface Part {
  pt: number
  msgId: number
  doc?: DocRef
}

export interface FolderItem {
  kind: 'folder'
  id: string
  parent: string
  name: string
  msgId: number
  ts: number
  x: Flags
  /** Encrypted, and the drive is locked: the real name isn't known. */
  locked: boolean
}

export interface FileItem {
  kind: 'file'
  id: string
  parent: string
  name: string
  msgId: number
  ts: number
  x: Flags
  size: number
  mime: string
  partsTotal: number
  /** Parts found so far, sorted by part number. */
  parts: Part[]
  /** False when some chunks are missing (e.g. interrupted upload). */
  complete: boolean
  /** Encrypted, and the drive is locked: the real name isn't known. */
  locked: boolean
  /** Salt of the file's encryption key, if the file is encrypted. */
  salt?: string
  /** SHA-256 of the content (hex), if known. */
  hash?: string
  /** Encrypted thumbnail (encrypted files only). */
  thumbPart?: Part
}

export type Item = FolderItem | FileItem

export interface Drive {
  items: Map<string, Item>
  children: Map<string, Item[]>
  /** Chunk messages whose file no longer exists (safe to delete). */
  orphanChunks: number[]
  configMsgId?: number
  /** Set when encryption is turned on for this drive. */
  encryption?: EncryptionConfig
}

export const LOCKED_FILE_NAME = 'Encrypted file'
export const LOCKED_FOLDER_NAME = 'Encrypted folder'

/**
 * Build the folder tree from channel messages. `secretOf` returns the decrypted caption fields of
 * encrypted items (undefined while the drive is locked).
 */
export function buildDrive(records: Iterable<MessageRecord>, secretOf: (sealed: string) => Secret | undefined = () => undefined): Drive {
  const items = new Map<string, Item>()
  const chunks = new Map<string, Part[]>()
  let configMsgId: number | undefined
  let encryption: EncryptionConfig | undefined

  const sorted = [...records].sort((a, b) => a.msgId - b.msgId)
  for (const r of sorted) {
    const m = r.meta
    if (m.t === 'cfg') {
      if (configMsgId === undefined) {
        configMsgId = r.msgId
        encryption = m.e
      }
    } else if (m.t === 'c') {
      const list = chunks.get(m.id) ?? []
      list.push({ pt: m.pt, msgId: r.msgId, doc: r.doc })
      chunks.set(m.id, list)
    } else if (!items.has(m.id)) {
      // On duplicate IDs the oldest message wins
      const secret = m.e ? secretOf(m.e) : undefined
      const locked = !!m.e && !secret
      if (m.t === 'd') {
        items.set(m.id, {
          kind: 'folder', id: m.id, parent: m.p, name: m.e ? (secret?.n ?? LOCKED_FOLDER_NAME) : m.n, msgId: r.msgId,
          ts: m.ts ?? r.date, x: m.x ?? {}, locked,
        })
      } else {
        items.set(m.id, {
          kind: 'file', id: m.id, parent: m.p, name: m.e ? (secret?.n ?? LOCKED_FILE_NAME) : m.n, msgId: r.msgId,
          ts: m.ts || r.date, x: m.x ?? {}, size: m.s,
          mime: m.e ? (secret?.m ?? 'application/octet-stream') : m.m,
          partsTotal: m.of, parts: [{ pt: 1, msgId: r.msgId, doc: r.doc }], complete: false, locked,
          ...(m.k && { salt: m.k }),
          ...((m.e ? secret?.h : m.h) && { hash: m.e ? secret!.h : m.h }),
        })
      }
    }
  }

  const orphanChunks: number[] = []
  for (const [id, list] of chunks) {
    const item = items.get(id)
    if (!item || item.kind !== 'file') {
      orphanChunks.push(...list.map((c) => c.msgId))
      continue
    }
    for (const c of list) {
      if (c.pt === 0 && item.salt) item.thumbPart ??= c
      else if (c.pt > 1 && c.pt <= item.partsTotal && !item.parts.some((p) => p.pt === c.pt)) item.parts.push(c)
    }
  }

  const children = new Map<string, Item[]>()
  for (const item of items.values()) {
    if (item.kind === 'file') {
      item.parts.sort((a, b) => a.pt - b.pt)
      item.complete = item.parts.length === item.partsTotal
    }
    // Items whose parent is missing (or points into a cycle) show up at the root, so nothing gets lost
    const parent = item.parent !== ROOT && !reachesRoot(items, item.id) ? ROOT : item.parent
    if (parent !== item.parent) item.parent = parent
    const list = children.get(parent) ?? []
    list.push(item)
    children.set(parent, list)
  }

  return { items, children, orphanChunks, configMsgId, encryption }
}

function reachesRoot(items: Map<string, Item>, id: string): boolean {
  const seen = new Set<string>()
  let cur = items.get(id)
  while (cur) {
    if (cur.parent === ROOT) return true
    if (seen.has(cur.id)) return false
    seen.add(cur.id)
    const parent = items.get(cur.parent)
    if (!parent || parent.kind !== 'folder') return false
    cur = parent
  }
  return false
}

/** Children of a folder, excluding trashed items. */
export function listFolder(drive: Drive, folderId: string, includeTrashed = false): Item[] {
  const list = drive.children.get(folderId) ?? []
  return includeTrashed ? list : list.filter((i) => !i.x.tr)
}

/** Path from root to the folder (root excluded). */
export function breadcrumbs(drive: Drive, folderId: string): FolderItem[] {
  const path: FolderItem[] = []
  const seen = new Set<string>()
  let cur = drive.items.get(folderId)
  while (cur && cur.kind === 'folder' && !seen.has(cur.id)) {
    seen.add(cur.id)
    path.unshift(cur)
    cur = drive.items.get(cur.parent)
  }
  return path
}

/** True if `id` is `ancestorId` or somewhere inside it. */
export function isDescendant(drive: Drive, id: string, ancestorId: string): boolean {
  const seen = new Set<string>()
  let cur: string | undefined = id
  while (cur && cur !== ROOT && !seen.has(cur)) {
    if (cur === ancestorId) return true
    seen.add(cur)
    cur = drive.items.get(cur)?.parent
  }
  return ancestorId === ROOT
}

/** An item plus everything inside it (depth-first, children before parents). */
export function collectTree(drive: Drive, id: string): Item[] {
  const out: Item[] = []
  const visit = (itemId: string) => {
    for (const child of drive.children.get(itemId) ?? []) visit(child.id)
    const item = drive.items.get(itemId)
    if (item) out.push(item)
  }
  visit(id)
  return out
}

/** All message IDs that make up the given items (folder markers + every file part). */
export function messageIds(items: Item[]): number[] {
  return items.flatMap((i) =>
    i.kind === 'file' ? [...i.parts.map((p) => p.msgId), ...(i.thumbPart ? [i.thumbPart.msgId] : [])] : [i.msgId],
  )
}

/** "photo.jpg" → "photo (1).jpg" if the name is already taken in that folder. */
export function uniqueName(drive: Drive, folderId: string, name: string, ignoreId?: string): string {
  const taken = new Set(
    listFolder(drive, folderId)
      .filter((i) => i.id !== ignoreId)
      .map((i) => i.name.toLowerCase()),
  )
  if (!taken.has(name.toLowerCase())) return name
  const dot = name.lastIndexOf('.')
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  for (let n = 1; ; n++) {
    const candidate = `${base} (${n})${ext}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

export function driveStats(drive: Drive): { files: number; folders: number; bytes: number } {
  let files = 0
  let folders = 0
  let bytes = 0
  for (const i of drive.items.values()) {
    if (i.kind === 'file') {
      files++
      bytes += i.size
    } else folders++
  }
  return { files, folders, bytes }
}

/** True if the item or any folder above it is in the trash. */
export function isHidden(drive: Drive, item: Item): boolean {
  const seen = new Set<string>()
  let cur: Item | undefined = item
  while (cur && !seen.has(cur.id)) {
    if (cur.x.tr) return true
    seen.add(cur.id)
    cur = drive.items.get(cur.parent)
  }
  return false
}

/** Visible (non-trashed) items matching a name query and an optional filter. */
export function searchItems(drive: Drive, query: string, filter?: (item: Item) => boolean, limit = 500): Item[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean)
  const out: Item[] = []
  for (const item of drive.items.values()) {
    if (filter && !filter(item)) continue
    const name = normalize(item.name)
    if (!terms.every((t) => name.includes(t))) continue
    if (isHidden(drive, item)) continue
    out.push(item)
    if (out.length >= limit) break
  }
  return out
}

function normalize(s: string): string {
  // Strip accents so "cafe" matches "Café"
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

/** Most recently added files. */
export function recentFiles(drive: Drive, limit = 100): Item[] {
  return [...drive.items.values()]
    .filter((i) => i.kind === 'file' && !isHidden(drive, i))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit)
}

export function starredItems(drive: Drive): Item[] {
  return [...drive.items.values()].filter((i) => i.x.fav && !isHidden(drive, i))
}

/** Items put in the trash directly (not those that are only inside a trashed folder). */
export function trashedItems(drive: Drive): Item[] {
  return [...drive.items.values()].filter((i) => {
    if (!i.x.tr) return false
    const parent = drive.items.get(i.parent)
    return !parent || !isHidden(drive, parent)
  })
}

/** "My Drive / Photos / 2026" for the folder an item is in (`root` is the drive's name). */
export function locationOf(drive: Drive, item: Item, root = 'My Drive'): string {
  return [root, ...breadcrumbs(drive, item.parent).map((f) => f.name)].join(' / ')
}

/**
 * A file in the drive with the same content: same SHA-256, or (for files uploaded before hashes
 * were stored) same size and name. Trashed and locked files are ignored.
 */
export function findDuplicate(drive: Drive, size: number, name: string, hash: string): FileItem | undefined {
  let byName: FileItem | undefined
  for (const i of drive.items.values()) {
    if (i.kind !== 'file' || i.size !== size || i.locked || !i.complete || isHidden(drive, i)) continue
    if (i.hash === hash) return i
    if (!i.hash && i.name.toLowerCase() === name.toLowerCase()) byName ??= i
  }
  return byName
}

/** True if some file might be a duplicate of a file with this size (worth hashing to check). */
export function hasFileOfSize(drive: Drive, size: number): boolean {
  for (const i of drive.items.values()) if (i.kind === 'file' && i.size === size && !i.locked && !i.x.tr) return true
  return false
}

/** One entry in a ZIP: a file, or a folder (kept so empty folders survive). */
export interface ZipEntry {
  path: string
  file?: FileItem
}

/**
 * The files and folders to put in a ZIP for the selected items (folders with everything inside).
 * Locked (encrypted) and incomplete files can't be downloaded; they are counted in `skipped`.
 */
export function zipEntries(drive: Drive, items: Item[]): { entries: ZipEntry[]; skipped: number; bytes: number } {
  const entries: ZipEntry[] = []
  const used = new Set<string>()
  let skipped = 0
  let bytes = 0
  const unique = (path: string) => {
    let p = path
    for (let n = 1; used.has(p.toLowerCase()); n++) {
      const dot = path.lastIndexOf('.')
      p = dot > path.lastIndexOf('/') + 1 ? `${path.slice(0, dot)} (${n})${path.slice(dot)}` : `${path} (${n})`
    }
    used.add(p.toLowerCase())
    return p
  }
  const walk = (item: Item, prefix: string) => {
    if (item.kind === 'file') {
      if (item.locked || !item.complete) return void skipped++
      entries.push({ path: unique(prefix + item.name), file: item })
      bytes += item.size
      return
    }
    if (item.locked) return void skipped++
    const path = unique(prefix + item.name)
    entries.push({ path })
    for (const child of listFolder(drive, item.id)) walk(child, `${path}/`)
  }
  for (const item of items) walk(item, '')
  return { entries, skipped, bytes }
}
