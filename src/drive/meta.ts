// Caption metadata format. See IMPLEMENTATION.md → "Metadata design".

import type { AccountConfig, LockInfo } from './crypto'

export const FORMAT_VERSION = 1
export const ROOT = 'root'
export const CAPTION_LIMIT = 1024
export const MAX_NAME_LENGTH = 255

export interface Flags {
  tr?: number // trashed at (unix seconds)
  fav?: 1
  enc?: 1
  /** TelePhotos' Locked photos folder. */
  lp?: 1
}

/** Encrypted fields of a folder or file caption (see `e`). */
export interface Secret {
  n: string
  m?: string
  /** SHA-256 of the content (hex). */
  h?: string
  /** Photos and videos: date taken (unix seconds). */
  dt?: number
  /** Photos and videos: width and height in pixels. */
  wh?: [number, number]
  /** TelePhotos: the albums the photo is in (album IDs). */
  al?: string[]
  /** TelePhotos, in Locked photos: the folder it was moved from (to go back there). */
  op?: string
}

export interface FolderMeta {
  td: 1
  t: 'd'
  id: string
  p: string
  /** Empty when encrypted (the name is in `e`). */
  n: string
  ts?: number
  x?: Flags
  /** Encrypted Secret (base64), when x.enc is set. */
  e?: string
  /** Set when the folder is locked with its own password. */
  l?: LockInfo
  /**
   * A locked item's name, sealed with the key of the folder it's in (not its own lock key), so the name
   * shows while it's locked. Contents stay behind the lock. Missing on items locked before this existed.
   */
  ln?: string
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
  /** SHA-256 of the content (hex); inside `e` for encrypted files. */
  h?: string
  /** Encrypted Secret (base64), when x.enc is set. */
  e?: string
  /** The file's key, wrapped by its level's key (base64), when x.enc is set. */
  k?: string
  /** Set when the file is locked with its own password. */
  l?: LockInfo
  /**
   * A locked item's name, sealed with the key of the folder it's in (not its own lock key), so the name
   * shows while it's locked. Contents stay behind the lock. Missing on items locked before this existed.
   */
  ln?: string
}

export interface ChunkMeta {
  td: 1
  t: 'c'
  id: string
  /** Part number (1..of). 0 is the encrypted thumbnail of an encrypted file. */
  pt: number
}

export interface ConfigMeta {
  td: 1
  t: 'cfg'
  app: 'teledrive'
  /** The TeleDrive password's check value (the master key, wrapped). */
  e?: AccountConfig
}

/**
 * A TelePhotos album. Its name is sealed in `e` (with the top level's key); which photos are in it is stored on the
 * photos (`Secret.al`), so a photo can be in several albums and deleting an album deletes no photo.
 */
export interface AlbumMeta {
  td: 1
  t: 'a'
  id: string
  ts: number
  x: Flags
  e: string
}

export type Meta = FolderMeta | FileMeta | ChunkMeta | ConfigMeta | AlbumMeta

export class MetaError extends Error {}

export function encode(meta: Meta): string {
  const text = JSON.stringify(meta)
  if (text.length > CAPTION_LIMIT) throw new MetaError('Metadata too long (name is too long)')
  return text
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const isInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0
const isPartIndex = (v: unknown): v is number => isInt(v) && (v as number) >= 1
const isHash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)

function isLock(v: unknown): v is LockInfo {
  const l = v as LockInfo
  return !!l && typeof l === 'object' && isStr(l.s) && isStr(l.w) && isInt(l.i) && l.i > 0
}

function isAccountConfig(v: unknown): v is AccountConfig {
  const c = v as AccountConfig
  return !!c && typeof c === 'object' && c.v === 1 && isStr(c.id) && isStr(c.s) && isStr(c.k) && isInt(c.i) && c.i > 0
}

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
  // Encrypted items carry their name in `e` instead of `n`
  const sealed = x?.enc === 1 && isStr(o.e) ? o.e : undefined
  const name = sealed ? '' : o.n
  const lock = sealed && isLock(o.l) ? { l: o.l, ...(isStr(o.ln) && { ln: o.ln }) } : {}

  switch (o.t) {
    case 'd':
      if (!isStr(o.id) || !isStr(o.p) || !(sealed || isStr(name))) return null
      return { td: 1, t: 'd', id: o.id, p: o.p, n: name as string, ts: isInt(o.ts) ? o.ts : undefined, x, ...(sealed && { e: sealed }), ...lock }
    case 'f':
      if (!isStr(o.id) || !isStr(o.p) || !(sealed || isStr(name)) || !isInt(o.s) || !isPartIndex(o.of)) return null
      if (sealed && !isStr(o.k)) return null
      return {
        td: 1, t: 'f', id: o.id, p: o.p, n: name as string, s: o.s,
        m: typeof o.m === 'string' ? o.m : 'application/octet-stream',
        of: o.of, ts: isInt(o.ts) ? o.ts : 0, x,
        ...(isHash(o.h) && { h: o.h }),
        ...(sealed && { e: sealed, k: o.k as string }),
        ...lock,
      }
    case 'c':
      if (!isStr(o.id) || !isInt(o.pt)) return null
      return { td: 1, t: 'c', id: o.id, pt: o.pt }
    case 'cfg':
      return { td: 1, t: 'cfg', app: 'teledrive', ...(isAccountConfig(o.e) && { e: o.e }) }
    case 'a':
      if (!isStr(o.id) || !sealed) return null
      return { td: 1, t: 'a', id: o.id, ts: isInt(o.ts) ? o.ts : 0, x: x ?? {}, e: sealed }
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
