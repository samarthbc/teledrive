// Caption metadata format. See IMPLEMENTATION.md → "Metadata design".

export const FORMAT_VERSION = 1
export const ROOT = 'root'
export const CAPTION_LIMIT = 1024
export const MAX_NAME_LENGTH = 255

export interface Flags {
  tr?: number // trashed at (unix seconds)
  fav?: 1
  enc?: 1
}

export interface FolderMeta {
  td: 1
  t: 'd'
  id: string
  p: string
  n: string
  ts?: number
  x?: Flags
}

export interface FileMeta {
  td: 1
  t: 'f'
  id: string
  p: string
  n: string
  s: number
  m: string
  of: number
  ts: number
  x?: Flags
}

export interface ChunkMeta {
  td: 1
  t: 'c'
  id: string
  pt: number
}

export interface ConfigMeta {
  td: 1
  t: 'cfg'
  app: 'teledrive'
}

export type Meta = FolderMeta | FileMeta | ChunkMeta | ConfigMeta

export class MetaError extends Error {}

export function encode(meta: Meta): string {
  const text = JSON.stringify(meta)
  if (text.length > CAPTION_LIMIT) throw new MetaError('Metadata too long (name is too long)')
  return text
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const isInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0
const isPartIndex = (v: unknown): v is number => isInt(v) && (v as number) >= 1

/** Parse a message caption. Returns null for anything that isn't valid TeleDrive metadata. */
export function decode(text: string | undefined | null): Meta | null {
  if (!text || text[0] !== '{') return null
  let o: Record<string, unknown>
  try {
    o = JSON.parse(text)
  } catch {
    return null
  }
  if (!o || typeof o !== 'object' || o.td !== FORMAT_VERSION) return null
  const x = o.x && typeof o.x === 'object' ? (o.x as Flags) : undefined

  switch (o.t) {
    case 'd':
      if (!isStr(o.id) || !isStr(o.p) || !isStr(o.n)) return null
      return { td: 1, t: 'd', id: o.id, p: o.p, n: o.n, ts: isInt(o.ts) ? o.ts : undefined, x }
    case 'f':
      if (!isStr(o.id) || !isStr(o.p) || !isStr(o.n) || !isInt(o.s) || !isPartIndex(o.of)) return null
      return {
        td: 1, t: 'f', id: o.id, p: o.p, n: o.n, s: o.s,
        m: typeof o.m === 'string' ? o.m : 'application/octet-stream',
        of: o.of, ts: isInt(o.ts) ? o.ts : 0, x,
      }
    case 'c':
      if (!isStr(o.id) || !isPartIndex(o.pt)) return null
      return { td: 1, t: 'c', id: o.id, pt: o.pt }
    case 'cfg':
      return { td: 1, t: 'cfg', app: 'teledrive' }
    default:
      return null
  }
}

/** Validate a user-entered file or folder name. Returns an error message, or null if valid. */
export function validateName(name: string): string | null {
  const n = name.trim()
  if (!n) return 'Name cannot be empty'
  if (n.length > MAX_NAME_LENGTH) return `Name must be at most ${MAX_NAME_LENGTH} characters`
  if (/[/\\]/.test(n)) return 'Name cannot contain / or \\'
  if (n === '.' || n === '..') return 'Invalid name'
  return null
}
