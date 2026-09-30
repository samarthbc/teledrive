// End-to-end encryption. See IMPLEMENTATION.md → "4.1 End-to-end encryption".
//
// Keys:
//   password ──PBKDF2──▶ password key ──unwraps──▶ master key (random, stored wrapped in the config message)
//   master ──HKDF(file salt)──▶ one AES-GCM key per file
//   master ──HKDF("names")──▶ key for captions (names, types, hashes)
// File contents are encrypted in blocks whose ciphertext is exactly 1 MB, so every Telegram download
// request (1 MB, aligned) is one block that can be decrypted on its own: streaming and seeking still work.

import type { ByteSource } from './upload'

/** Ciphertext bytes per block: the same as a Telegram download request. */
export const CIPHER_BLOCK = 1024 * 1024
const TAG = 16
/** Plaintext bytes per block. */
export const PLAIN_BLOCK = CIPHER_BLOCK - TAG
const ITERATIONS = 600_000
const SALT_BYTES = 16

/** Stored in the drive's config message. Contains nothing secret. */
export interface EncryptionConfig {
  v: 1
  /** Key ID; stays the same when the password changes. */
  id: string
  /** PBKDF2 salt (base64). */
  s: string
  /** PBKDF2 iterations. */
  i: number
  /** Master key wrapped with the password key: IV + ciphertext (base64). */
  k: string
}

export interface Keys {
  id: string
  master: CryptoKey
  names: CryptoKey
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

export const newFileSalt = () => toB64(randomBytes(SALT_BYTES))

// ---- keys ----

async function passwordKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function keysFrom(id: string, raw: Uint8Array<ArrayBuffer>): Promise<Keys> {
  const master = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey'])
  raw.fill(0)
  const names = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('teledrive names') },
    master,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  return { id, master, names }
}

async function wrap(raw: Uint8Array<ArrayBuffer>, password: string): Promise<Pick<EncryptionConfig, 's' | 'i' | 'k'>> {
  const salt = randomBytes(SALT_BYTES)
  const key = await passwordKey(password, salt, ITERATIONS)
  const iv = randomBytes(12)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, raw))
  return { s: toB64(salt), i: ITERATIONS, k: toB64(concat(iv, ct)) }
}

async function unwrap(config: EncryptionConfig, password: string): Promise<Uint8Array<ArrayBuffer>> {
  const key = await passwordKey(password, fromB64(config.s), config.i)
  const data = fromB64(config.k)
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12) }, key, data.subarray(12)))
  } catch {
    throw new WrongPasswordError()
  }
}

/** New encryption setup: a random master key protected by the password. */
export async function createEncryption(password: string): Promise<{ config: EncryptionConfig; keys: Keys }> {
  const raw = randomBytes(32)
  const id = toB64(randomBytes(9))
  const config: EncryptionConfig = { v: 1, id, ...(await wrap(raw, password)) }
  return { config, keys: await keysFrom(id, raw) }
}

/** Throws WrongPasswordError if the password is wrong. */
export async function unlockKeys(config: EncryptionConfig, password: string): Promise<Keys> {
  return keysFrom(config.id, await unwrap(config, password))
}

/** Same master key (so every file stays readable), protected by a new password. */
export async function changePassword(config: EncryptionConfig, oldPassword: string, newPassword: string): Promise<EncryptionConfig> {
  const raw = await unwrap(config, oldPassword)
  const next = { ...config, ...(await wrap(raw, newPassword)) }
  raw.fill(0)
  return next
}

// ---- unlocked state ----

let keys: Keys | null = null
const fileKeys = new Map<string, Promise<CryptoKey>>()

export function setKeys(k: Keys | null): void {
  keys = k
  fileKeys.clear()
}

export function isUnlocked(): boolean {
  return !!keys
}

function requireKeys(): Keys {
  if (!keys) throw new Error('Encrypted files are locked. Unlock them with your encryption password first.')
  return keys
}

/** The AES key for one file (derived from the master key and the file's salt). */
export function fileKey(salt: string): Promise<CryptoKey> {
  const { master } = requireKeys()
  let k = fileKeys.get(salt)
  if (!k) {
    k = crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: fromB64(salt), info: enc.encode('teledrive file') },
      master,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
    fileKeys.set(salt, k)
  }
  return k
}

// ---- file blocks ----

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

// ---- captions ----

/** Encrypt caption fields (name, type, hash) into a base64 string. */
export async function seal(value: object): Promise<string> {
  const { names } = requireKeys()
  const iv = randomBytes(12)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, names, enc.encode(JSON.stringify(value))))
  return toB64(concat(iv, ct))
}

export async function open<T>(sealed: string): Promise<T> {
  const { names } = requireKeys()
  const data = fromB64(sealed)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12) }, names, data.subarray(12))
  return JSON.parse(dec.decode(plain)) as T
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}
