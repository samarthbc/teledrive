// 2FA codes (IMPLEMENTATION.md → "Phase 20"): RFC 4226 (HOTP) and RFC 6238 (TOTP) with WebCrypto, the same codes
// Google Authenticator shows. A login stores its 2FA as an otpauth:// link (or just the key).

export type OtpAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-512'

export interface OtpParams {
  type: 'totp' | 'hotp'
  secret: Uint8Array<ArrayBuffer>
  algorithm: OtpAlgorithm
  digits: number
  /** TOTP: seconds per code. */
  period: number
  /** HOTP: the next counter value. */
  counter: number
  issuer?: string
  account?: string
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Base32 (RFC 4648) to bytes; ignores spaces, dashes, case and padding. Null if it isn't base32. */
export function base32Decode(input: string): Uint8Array<ArrayBuffer> | null {
  const s = input.toUpperCase().replace(/[\s=-]/g, '')
  if (!s || /[^A-Z2-7]/.test(s)) return null
  const out = new Uint8Array(Math.floor((s.length * 5) / 8))
  let bits = 0
  let value = 0
  let i = 0
  for (const ch of s) {
    value = ((value << 5) | B32.indexOf(ch)) & 0xffff
    bits += 5
    if (bits >= 8) {
      out[i++] = (value >>> (bits - 8)) & 0xff
      bits -= 8
    }
  }
  return out
}

export function base32Encode(bytes: Uint8Array): string {
  let out = ''
  let bits = 0
  let value = 0
  for (const b of bytes) {
    value = ((value << 8) | b) & 0xffff
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

const ALGORITHMS: Record<string, OtpAlgorithm> = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' }

/** A pasted key ("JBSW Y3DP EHPK 3PXP") or an otpauth:// link. Null if it's neither. */
export function parseOtp(input: string | undefined): OtpParams | null {
  const text = input?.trim()
  if (!text) return null
  if (!/^otpauth:\/\//i.test(text)) {
    const secret = base32Decode(text)
    return secret && secret.length >= 5 ? { type: 'totp', secret, algorithm: 'SHA-1', digits: 6, period: 30, counter: 0 } : null
  }
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  const type = url.host.toLowerCase()
  if (type !== 'totp' && type !== 'hotp') return null
  const q = url.searchParams
  const secret = base32Decode(q.get('secret') ?? '')
  if (!secret || secret.length < 5) return null
  const label = decodeURIComponent(url.pathname.replace(/^\//, ''))
  const [labelIssuer, account] = label.includes(':') ? label.split(/:(.*)/s).map((s) => s.trim()) : [undefined, label.trim()]
  const digits = Number(q.get('digits') ?? 6)
  const period = Number(q.get('period') ?? 30)
  return {
    type,
    secret,
    algorithm: ALGORITHMS[(q.get('algorithm') ?? 'SHA1').toUpperCase()] ?? 'SHA-1',
    digits: digits >= 6 && digits <= 8 ? digits : 6,
    period: period > 0 && period <= 300 ? period : 30,
    counter: Math.max(0, Number(q.get('counter') ?? 0) || 0),
    issuer: q.get('issuer')?.trim() || labelIssuer || undefined,
    account: account || undefined,
  }
}

/** The otpauth:// link for a 2FA account (stored on the login). */
export function toOtpauth(p: OtpParams): string {
  const label = encodeURIComponent(p.issuer ? `${p.issuer}:${p.account ?? ''}` : (p.account ?? ''))
  const q = new URLSearchParams({ secret: base32Encode(p.secret) })
  if (p.issuer) q.set('issuer', p.issuer)
  if (p.algorithm !== 'SHA-1') q.set('algorithm', p.algorithm.replace('-', ''))
  if (p.digits !== 6) q.set('digits', String(p.digits))
  if (p.type === 'totp' && p.period !== 30) q.set('period', String(p.period))
  if (p.type === 'hotp') q.set('counter', String(p.counter))
  return `otpauth://${p.type}/${label}?${q}`
}

const keys = new Map<string, Promise<CryptoKey>>()

async function hmacKey(secret: Uint8Array<ArrayBuffer>, algorithm: OtpAlgorithm): Promise<CryptoKey> {
  const id = `${algorithm}:${base32Encode(secret)}`
  let k = keys.get(id)
  if (!k) {
    k = crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: algorithm }, false, ['sign'])
    keys.set(id, k)
  }
  return k
}

/** Forget the imported keys (when the vault locks). */
export function forgetOtpKeys(): void {
  keys.clear()
}

/** RFC 4226. */
export async function hotp(p: Pick<OtpParams, 'secret' | 'algorithm' | 'digits'>, counter: number): Promise<string> {
  const msg = new Uint8Array(8)
  new DataView(msg.buffer).setBigUint64(0, BigInt(counter))
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(p.secret, p.algorithm), msg))
  const offset = mac[mac.length - 1] & 0x0f
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3]
  return String(bin % 10 ** p.digits).padStart(p.digits, '0')
}

/** The code now (TOTP), or for the current counter (HOTP), and the seconds it has left (TOTP). */
export async function currentCode(p: OtpParams, nowMs = Date.now()): Promise<{ code: string; remaining: number }> {
  if (p.type === 'hotp') return { code: await hotp(p, p.counter), remaining: 0 }
  const step = Math.floor(nowMs / 1000 / p.period)
  return { code: await hotp(p, step), remaining: p.period - (Math.floor(nowMs / 1000) % p.period) }
}

/** "842 091" / "8420 9113". */
export const groupCode = (code: string) => (code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : `${code.slice(0, 3)} ${code.slice(3)}`)
