// Encryption building blocks. See IMPLEMENTATION.md → "Phase 6: Security".
//
// Keys:
//   TeleDrive password ──PBKDF2──▶ unwraps the master key (random; stored wrapped in each drive's config message)
//   master ──HKDF──▶ root level key
//   level key = root key, or the lock key of a locked file/folder (random; wrapped by its parent's level key
//               AND its own password)
//   level key wraps: each file's random file key, and the sealed caption fields (name, type, hash)
// File contents are encrypted with the file key in blocks whose ciphertext is exactly 1 MB, so every
// Telegram download request (1 MB, aligned) is one block that decrypts on its own: streaming and seeking work.

import type { ByteSource } from './upload'

/** Ciphertext bytes per block: the same as a Telegram download request. */
export const CIPHER_BLOCK = 1024 * 1024
const TAG = 16
/** Plaintext bytes per block. */
export const PLAIN_BLOCK = CIPHER_BLOCK - TAG
const ITERATIONS = 600_000
const SALT_BYTES = 16

/** The TeleDrive password's check value, stored in each drive's config message. Contains nothing secret. */
export interface AccountConfig {
  v: 1
  /** Key ID (the same master key in every drive). */
  id: string
  /** PBKDF2 salt (base64). */
  s: string
  /** PBKDF2 iterations. */
  i: number
  /** Master key wrapped with the password key: IV + ciphertext (base64). Unwraps only with the right password. */
  k: string
}

/** The account's keys, available once the TeleDrive password has been entered on this device. */
export interface AccountKeys {
  id: string
  master: CryptoKey
  /** Level key of everything that isn't locked. */
  root: CryptoKey
}

/** A locked file or folder's lock: its lock key, wrapped by the parent level's key and its own password. */
export interface LockInfo {
  /** PBKDF2 salt of the item password (base64). */
  s: string
  i: number
  /** AES-GCM(parent level key, AES-GCM(password key, lock key)), base64. */
  w: string
}

export class WrongPasswordError extends Error {
  constructor() {
    super('Wrong password')
  }
}

const enc = new TextEncoder()
const dec = new TextDecoder()

// ---- base64 ----

export function toB64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n))
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

// ---- AES-GCM helpers ----

/** Encrypt bytes with a random IV; returns base64(IV + ciphertext). */
export async function wrapBytes(key: CryptoKey, raw: Uint8Array<ArrayBuffer>): Promise<string> {
  const iv = randomBytes(12)
  return toB64(concat(iv, new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, raw))))
}

/** Throws (OperationError) if the key is wrong or the data was changed. */
export async function unwrapBytes(key: CryptoKey, wrapped: string): Promise<Uint8Array<ArrayBuffer>> {
  const data = fromB64(wrapped)
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12) }, key, data.subarray(12)))
}

export async function importAes(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
  raw.fill(0)
  return key
}

export async function passwordKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// ---- TeleDrive password (account) ----

async function accountKeysFrom(id: string, raw: Uint8Array<ArrayBuffer>): Promise<AccountKeys> {
  const master = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey'])
  raw.fill(0)
  const root = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('teledrive root') },
    master,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  return { id, master, root }
}

/** New TeleDrive password: a random master key protected by it. */
export async function createAccount(password: string): Promise<{ config: AccountConfig; keys: AccountKeys }> {
  const raw = randomBytes(32)
  const salt = randomBytes(SALT_BYTES)
  const k = await wrapBytes(await passwordKey(password, salt, ITERATIONS), raw)
  const config: AccountConfig = { v: 1, id: toB64(randomBytes(9)), s: toB64(salt), i: ITERATIONS, k }
  return { config, keys: await accountKeysFrom(config.id, raw) }
}

/** Throws WrongPasswordError if the TeleDrive password is wrong. */
export async function unlockAccount(config: AccountConfig, password: string): Promise<AccountKeys> {
  const key = await passwordKey(password, fromB64(config.s), config.i)
  let raw: Uint8Array<ArrayBuffer>
  try {
    raw = await unwrapBytes(key, config.k)
  } catch {
    throw new WrongPasswordError()
  }
  return accountKeysFrom(config.id, raw)
}

/** Check the TeleDrive password (e.g. before locking something). */
export async function checkAccountPassword(config: AccountConfig, password: string): Promise<boolean> {
  try {
    await unlockAccount(config, password)
    return true
  } catch (e) {
    if (e instanceof WrongPasswordError) return false
    throw e
  }
}

// ---- Locks (file/folder passwords) ----

/** Lock an item: a new random lock key, wrapped by its password and by the parent level's key. */
export async function newLock(parentKey: CryptoKey, password: string): Promise<{ lock: LockInfo; key: CryptoKey }> {
  const raw = randomBytes(32)
  const salt = randomBytes(SALT_BYTES)
  const inner = fromB64(await wrapBytes(await passwordKey(password, salt, ITERATIONS), raw))
  const w = await wrapBytes(parentKey, inner)
  return { lock: { s: toB64(salt), i: ITERATIONS, w }, key: await importAes(raw) }
}

/** Open a lock: needs the parent level's key and the item's password (WrongPasswordError otherwise). */
export async function openLock(lock: LockInfo, parentKey: CryptoKey, password: string): Promise<CryptoKey> {
  const inner = await innerOf(lock, parentKey)
  try {
    return await importAes(await unwrapBytes(await passwordKey(password, fromB64(lock.s), lock.i), toB64(inner)))
  } catch {
    throw new WrongPasswordError()
  }
}

async function innerOf(lock: LockInfo, parentKey: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  try {
    return await unwrapBytes(parentKey, lock.w)
  } catch {
    throw new Error('This lock could not be read (the item may be damaged)')
  }
}

/** The item moved to another level: re-wrap the outer layer (its password isn't needed). */
export async function moveLock(lock: LockInfo, from: CryptoKey, to: CryptoKey): Promise<LockInfo> {
  return { ...lock, w: await wrapBytes(to, await innerOf(lock, from)) }
}

/** New password for a locked item (the lock key stays the same, so nothing inside changes). */
export async function changeLockPassword(lock: LockInfo, parentKey: CryptoKey, oldPassword: string, newPassword: string): Promise<LockInfo> {
  const inner = await innerOf(lock, parentKey)
  let raw: Uint8Array<ArrayBuffer>
  try {
    raw = await unwrapBytes(await passwordKey(oldPassword, fromB64(lock.s), lock.i), toB64(inner))
  } catch {
    throw new WrongPasswordError()
  }
  const salt = randomBytes(SALT_BYTES)
  const newInner = fromB64(await wrapBytes(await passwordKey(newPassword, salt, ITERATIONS), raw))
  raw.fill(0)
  return { s: toB64(salt), i: ITERATIONS, w: await wrapBytes(parentKey, newInner) }
}

// ---- File keys ----

/** A new random key for one file, and its wrapped form (stored in the caption). */
export async function newFileKey(levelKey: CryptoKey): Promise<{ wrapped: string; key: CryptoKey }> {
  const raw = randomBytes(32)
  const wrapped = await wrapBytes(levelKey, raw)
  return { wrapped, key: await importAes(raw) }
}

export async function openFileKey(levelKey: CryptoKey, wrapped: string): Promise<CryptoKey> {
  try {
    return await importAes(await unwrapBytes(levelKey, wrapped))
  } catch {
    throw new Error('This file could not be decrypted (it is damaged or was changed)')
  }
}

/** The file moved to another level (or got locked): re-wrap its key. The content stays as it is. */
export async function rewrapFileKey(wrapped: string, from: CryptoKey, to: CryptoKey): Promise<string> {
  const raw = await unwrapBytes(from, wrapped)
  const out = await wrapBytes(to, raw)
  raw.fill(0)
  return out
}

// ---- Captions ----

/** Encrypt caption fields (name, type, hash) with a level key. */
export async function seal(levelKey: CryptoKey, value: object): Promise<string> {
  return wrapBytes(levelKey, enc.encode(JSON.stringify(value)))
}

export async function unseal<T>(levelKey: CryptoKey, sealed: string): Promise<T> {
  return JSON.parse(dec.decode(await unwrapBytes(levelKey, sealed))) as T
}

// ---- File blocks ----

/** IV for a content block: its index in the file. Each file has its own key, so IVs never repeat. */
function blockIv(index: number): Uint8Array<ArrayBuffer> {
  const iv = new Uint8Array(12)
  new DataView(iv.buffer).setBigUint64(4, BigInt(index))
  return iv
}

/** IV for the file's thumbnail (can't clash with a block index). */
function thumbIv(): Uint8Array<ArrayBuffer> {
  const iv = new Uint8Array(12)
  iv[0] = 1
  return iv
}

export async function encryptBlock(key: CryptoKey, index: number, plain: ArrayBuffer): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: blockIv(index) }, key, plain))
}

export async function decryptBlock(key: CryptoKey, index: number, cipher: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blockIv(index) }, key, cipher as Uint8Array<ArrayBuffer>))
  } catch {
    throw new Error('This file could not be decrypted (it is damaged or was changed)')
  }
}

export async function encryptThumb(key: CryptoKey, blob: Blob): Promise<Blob> {
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: thumbIv() }, key, await blob.arrayBuffer())
  return new Blob([ct])
}

export async function decryptThumb(key: CryptoKey, cipher: Uint8Array): Promise<Blob> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: thumbIv() }, key, cipher as Uint8Array<ArrayBuffer>)
  return new Blob([plain], { type: 'image/jpeg' })
}

/** Size on Telegram of an encrypted file with `plain` bytes. */
export function cipherSize(plain: number): number {
  const full = Math.floor(plain / PLAIN_BLOCK)
  const rest = plain % PLAIN_BLOCK
  return full * CIPHER_BLOCK + (rest ? rest + TAG : 0)
}

/** A file's bytes as they are uploaded: encrypted, block by block, on demand. */
export class EncryptedSource implements ByteSource {
  private cache: Map<number, Promise<Uint8Array>>

  constructor(
    private src: ByteSource,
    private key: CryptoKey,
    private start = 0,
    private end = cipherSize(src.size),
    cache?: Map<number, Promise<Uint8Array>>,
  ) {
    this.cache = cache ?? new Map()
  }

  get size(): number {
    return this.end - this.start
  }

  slice(start = 0, end = this.size): EncryptedSource {
    return new EncryptedSource(this.src, this.key, this.start + start, this.start + Math.min(end, this.size), this.cache)
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const out = new Uint8Array(this.size)
    if (!this.size) return out.buffer
    const first = Math.floor(this.start / CIPHER_BLOCK)
    const last = Math.floor((this.end - 1) / CIPHER_BLOCK)
    for (let b = first; b <= last; b++) {
      const block = await this.block(b)
      const blockStart = b * CIPHER_BLOCK
      const from = Math.max(this.start, blockStart)
      const to = Math.min(this.end, blockStart + block.length)
      out.set(block.subarray(from - blockStart, to - blockStart), from - this.start)
    }
    return out.buffer
  }

  /** Upload parts are half a block, so each block is used twice: keep the last few. */
  private block(index: number): Promise<Uint8Array> {
    let p = this.cache.get(index)
    if (!p) {
      p = this.src
        .slice(index * PLAIN_BLOCK, Math.min((index + 1) * PLAIN_BLOCK, this.src.size))
        .arrayBuffer()
        .then((plain) => encryptBlock(this.key, index, plain))
      this.cache.set(index, p)
      p.catch(() => this.cache.delete(index))
      while (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value!)
    }
    return p
  }
}
