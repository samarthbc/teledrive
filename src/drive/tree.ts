import { ROOT, type Flags, type Meta } from './meta'

/** Where a Telegram document lives; enough to download it without re-fetching the message. */
export interface DocRef {
  docId: string
  accessHash: string
  fileRef: Uint8Array
  dcId: number
  size: number
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
}

export type Item = FolderItem | FileItem

export interface Drive {
  items: Map<string, Item>
  children: Map<string, Item[]>
  /** Chunk messages whose file no longer exists (safe to delete). */
  orphanChunks: number[]
  configMsgId?: number
}

export function buildDrive(records: Iterable<MessageRecord>): Drive {
  const items = new Map<string, Item>()
  const chunks = new Map<string, Part[]>()
  let configMsgId: number | undefined

  const sorted = [...records].sort((a, b) => a.msgId - b.msgId)
  for (const r of sorted) {
    const m = r.meta
    if (m.t === 'cfg') {
      configMsgId ??= r.msgId
    } else if (m.t === 'c') {
      const list = chunks.get(m.id) ?? []
      list.push({ pt: m.pt, msgId: r.msgId, doc: r.doc })
      chunks.set(m.id, list)
    } else if (!items.has(m.id)) {
      // On duplicate IDs the oldest message wins
      if (m.t === 'd') {
        items.set(m.id, {
          kind: 'folder', id: m.id, parent: m.p, name: m.n, msgId: r.msgId,
          ts: m.ts ?? r.date, x: m.x ?? {},
        })
      } else {
        items.set(m.id, {
          kind: 'file', id: m.id, parent: m.p, name: m.n, msgId: r.msgId,
          ts: m.ts || r.date, x: m.x ?? {}, size: m.s, mime: m.m, partsTotal: m.of,
          parts: [{ pt: 1, msgId: r.msgId, doc: r.doc }], complete: false,
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
      if (c.pt > 1 && c.pt <= item.partsTotal && !item.parts.some((p) => p.pt === c.pt)) item.parts.push(c)
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

  return { items, children, orphanChunks, configMsgId }
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
  return items.flatMap((i) => (i.kind === 'file' ? i.parts.map((p) => p.msgId) : [i.msgId]))
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
