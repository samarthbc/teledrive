// TeleWarden's keys. See IMPLEMENTATION.md → "Phase 19.3".
//
//   TeleDrive password ─▶ master key ─▶ ROOT KEY              (remembered on the device)
//   master password (only in the user's head) ─Argon2id─▶ password key
//   recovery code (written down)              ─HKDF─────▶ recovery key
//   VAULT KEY (random), stored twice in the vault channel's config message:
//     k = AES-GCM(root key, AES-GCM(password key, vault key))
//     r = AES-GCM(root key, AES-GCM(recovery key, vault key))
//   vault key ─▶ every item: AES-GCM with the item's ID as additional data, compressed and padded

import { argon2id } from 'hash-wasm'
import { fromB64, importAes, randomBytes, seal, toB64, unseal, unwrapBytes, wrapBytes, WrongPasswordError } from '../drive/crypto'

export interface Kdf {
  a: 'argon2id'
  /** Memory in KiB. */
  m: number
  /** Passes. */
  t: number
  /** Lanes. */
  p: number
}

/** How the vault key is protected. Contains nothing that opens it without the master password or recovery code. */
export interface VaultConfig {
  v: 1
  kdf: Kdf
  /** Argon2id salt (base64). */
  s: string
  /** The vault key, under the master password and the root key. */
  k: string
  /** The vault key, under the recovery code and the root key. */
  r: string
  /** Optional hint, sealed with the root key (only the account's devices can read it). */
  h?: string
  /** Created (unix seconds). */
  ct: number
}

/** Bitwarden's defaults: 64 MB, 3 passes, 4 lanes (about a second on a phone). */
export const DEFAULT_KDF: Kdf = { a: 'argon2id', m: 65536, t: 3, p: 4 }

export class WrongCodeError extends Error {
  constructor() {
    super('That recovery code doesn’t match')
  }
}

export class DamagedItemError extends Error {
  constructor() {
    super('This item could not be decrypted (it is damaged or was changed)')
  }
}

const enc = new TextEncoder()
const dec = new TextDecoder()

// ---- master password ----

async function masterKey(password: string, salt: Uint8Array, kdf: Kdf): Promise<CryptoKey> {
  const raw = await argon2id({
    password: password.normalize('NFC'),
    salt,
    parallelism: kdf.p,
    iterations: kdf.t,
    memorySize: kdf.m,
    hashLength: 32,
    outputType: 'binary',
  })
  return importAes(new Uint8Array(raw))
}

// ---- recovery code: 160 random bits as 32 Crockford base32 characters ----

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CODE_BYTES = 20

/** A new recovery code, e.g. `K7QP-M2XD-…` (8 groups of 4). */
export function newRecoveryCode(): string {
  return formatCode(randomBytes(CODE_BYTES))
}

function formatCode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  return out.match(/.{4}/g)!.join('-')
}

/** The code's bytes, or null if it isn't a valid code. Ignores case, spaces and dashes; I/L read as 1 and O as 0. */
export function parseRecoveryCode(code: string): Uint8Array<ArrayBuffer> | null {
  const clean = code.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0')
  if (clean.length !== 32) return null
  const out = new Uint8Array(CODE_BYTES)
  let bits = 0
  let value = 0
  let i = 0
  for (const ch of clean) {
    const v = CROCKFORD.indexOf(ch)
    if (v < 0) return null
    value = ((value << 5) | v) & 0xffff
    bits += 5
    if (bits >= 8) {
      out[i++] = (value >>> (bits - 8)) & 0xff
      bits -= 8
    }
  }
  return out
}

/** High entropy, so a fast KDF is enough. */
async function recoveryKey(bytes: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('telewarden recovery') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// ---- the vault key's two layers ----

async function wrapTwice(root: CryptoKey, inner: CryptoKey, raw: Uint8Array<ArrayBuffer>): Promise<string> {
  return wrapBytes(root, fromB64(await wrapBytes(inner, raw)))
}

/** The vault key's raw bytes; `wrong` is thrown if the inner key is wrong. */
async function unwrapTwice(root: CryptoKey, inner: CryptoKey, wrapped: string, wrong: () => Error): Promise<Uint8Array<ArrayBuffer>> {
  let middle: Uint8Array<ArrayBuffer>
  try {
    middle = await unwrapBytes(root, wrapped)
  } catch {
    throw new Error('TeleWarden’s key could not be read (it is damaged, or belongs to another account)')
  }
  try {
    return await unwrapBytes(inner, toB64(middle))
  } catch {
    throw wrong()
  }
}

export interface Opened {
  config: VaultConfig
  key: CryptoKey
}

/** Set up TeleWarden: a new vault key under the master password and a new recovery code. */
export async function createVault(root: CryptoKey, password: string, hint = '', kdf: Kdf = DEFAULT_KDF): Promise<Opened & { code: string }> {
  const raw = randomBytes(32)
  const salt = randomBytes(16)
  const code = newRecoveryCode()
  const config: VaultConfig = {
    v: 1,
    kdf,
    s: toB64(salt),
    k: await wrapTwice(root, await masterKey(password, salt, kdf), raw),
    r: await wrapTwice(root, await recoveryKey(parseRecoveryCode(code)!), raw),
    ...(hint.trim() && { h: await seal(root, { h: hint.trim() }) }),
    ct: Math.floor(Date.now() / 1000),
  }
  return { config, key: await importAes(raw), code }
}

/** Throws WrongPasswordError. */
export async function openWithPassword(config: VaultConfig, root: CryptoKey, password: string): Promise<CryptoKey> {
  return importAes(await rawWithPassword(config, root, password))
}

async function rawWithPassword(config: VaultConfig, root: CryptoKey, password: string) {
  const key = await masterKey(password, fromB64(config.s), config.kdf)
  return unwrapTwice(root, key, config.k, () => new WrongPasswordError())
}

/**
 * Forgotten master password: the recovery code opens the vault and a new master password and a new code are set
 * (the old code stops working). Throws WrongCodeError.
 */
export async function recover(
  config: VaultConfig, root: CryptoKey, code: string, newPassword: string,
): Promise<Opened & { code: string }> {
  const bytes = parseRecoveryCode(code)
  if (!bytes) throw new WrongCodeError()
  const raw = await unwrapTwice(root, await recoveryKey(bytes), config.r, () => new WrongCodeError())
  return rekey(config, root, raw, newPassword, newRecoveryCode())
}

/** Check a recovery code without changing anything. */
export async function checkRecoveryCode(config: VaultConfig, root: CryptoKey, code: string): Promise<boolean> {
  const bytes = parseRecoveryCode(code)
  if (!bytes) return false
  try {
    await unwrapTwice(root, await recoveryKey(bytes), config.r, () => new WrongCodeError())
    return true
  } catch (e) {
    if (e instanceof WrongCodeError) return false
    throw e
  }
}

/** New master password (nothing is re-encrypted; the recovery code keeps working). Throws WrongPasswordError. */
export async function changePassword(config: VaultConfig, root: CryptoKey, current: string, next: string): Promise<VaultConfig> {
  const raw = await rawWithPassword(config, root, current)
  const salt = randomBytes(16)
  const k = await wrapTwice(root, await masterKey(next, salt, DEFAULT_KDF), raw)
  raw.fill(0)
  return { ...config, kdf: DEFAULT_KDF, s: toB64(salt), k }
}

/** A new recovery code (the old one stops working). Throws WrongPasswordError. */
export async function newCode(config: VaultConfig, root: CryptoKey, password: string): Promise<{ config: VaultConfig; code: string }> {
  const raw = await rawWithPassword(config, root, password)
  const code = newRecoveryCode()
  const r = await wrapTwice(root, await recoveryKey(parseRecoveryCode(code)!), raw)
  raw.fill(0)
  return { config: { ...config, r }, code }
}

async function rekey(config: VaultConfig, root: CryptoKey, raw: Uint8Array<ArrayBuffer>, password: string, code: string) {
  const salt = randomBytes(16)
  const next: VaultConfig = {
    ...config,
    kdf: DEFAULT_KDF,
    s: toB64(salt),
    k: await wrapTwice(root, await masterKey(password, salt, DEFAULT_KDF), raw),
    r: await wrapTwice(root, await recoveryKey(parseRecoveryCode(code)!), raw),
  }
  return { config: next, key: await importAes(raw), code }
}

/** The hint, if one was set (readable only with the account's root key). */
export async function readHint(config: VaultConfig, root: CryptoKey): Promise<string | null> {
  if (!config.h) return null
  try {
    return (await unseal<{ h: string }>(root, config.h)).h
  } catch {
    return null
  }
}

// ---- items ----

/** Sizes are rounded up to this, so a message's length says little about what's in it. */
const PAD = 256
const FORMAT_PLAIN = 0
const FORMAT_DEFLATE = 1

const ad = (id: string) => enc.encode(`tw1:${id}`)

async function deflate(data: Uint8Array<ArrayBuffer>, mode: 'compress' | 'decompress'): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([data]).stream().pipeThrough(
    mode === 'compress' ? new CompressionStream('deflate-raw') : new DecompressionStream('deflate-raw'),
  )
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** [format][length: 4 bytes][body][zero padding to a multiple of PAD] */
async function pack(json: string): Promise<Uint8Array<ArrayBuffer>> {
  const plain = enc.encode(json)
  let body = plain
  let format = FORMAT_PLAIN
  try {
    const packed = await deflate(plain, 'compress')
    if (packed.length < plain.length) {
      body = packed
      format = FORMAT_DEFLATE
    }
  } catch {
    // No CompressionStream: stored as it is
  }
  const size = Math.ceil((5 + body.length) / PAD) * PAD
  const out = new Uint8Array(size)
  out[0] = format
  new DataView(out.buffer).setUint32(1, body.length)
  out.set(body, 5)
  return out
}

async function unpack(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const length = new DataView(data.buffer, data.byteOffset).getUint32(1)
  const body = data.slice(5, 5 + length)
  if (data[0] === FORMAT_DEFLATE) return dec.decode(await deflate(body, 'decompress'))
  if (data[0] === FORMAT_PLAIN) return dec.decode(body)
  throw new DamagedItemError()
}

/** Encrypt an item (or folder) tied to its ID: its ciphertext can't be moved to another message unnoticed. */
export async function sealItem(key: CryptoKey, id: string, value: object): Promise<string> {
  const iv = randomBytes(12)
  const data = await pack(JSON.stringify({ ...value, id }))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: ad(id) }, key, data))
  const out = new Uint8Array(12 + ct.length)
  out.set(iv)
  out.set(ct, 12)
  return toB64(out)
}

/** Throws DamagedItemError if it was changed, sealed for another ID, or with another key. */
export async function unsealItem<T extends object>(key: CryptoKey, id: string, sealed: string): Promise<T> {
  try {
    const data = fromB64(sealed)
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12), additionalData: ad(id) }, key, data.subarray(12))
    const value = JSON.parse(await unpack(new Uint8Array(plain))) as T & { id?: string }
    if (value.id !== id) throw new DamagedItemError()
    return value
  } catch {
    throw new DamagedItemError()
  }
}
