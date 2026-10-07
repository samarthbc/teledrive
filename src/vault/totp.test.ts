import { describe, expect, it } from 'vitest'
import { toB64 } from '../drive/crypto'
import { parseMigration } from './googleAuth'
import { matchLogins } from './otpMatch'
import { base32Decode, base32Encode, currentCode, groupCode, hotp, parseOtp, toOtpauth, type OtpParams } from './totp'
import type { LoginItem } from './items'

const ascii = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>

describe('RFC 6238 test vectors (8 digits)', () => {
  const cases: [OtpParams['algorithm'], string, number, string][] = [
    ['SHA-1', '12345678901234567890', 59, '94287082'],
    ['SHA-1', '12345678901234567890', 1111111109, '07081804'],
    ['SHA-1', '12345678901234567890', 1234567890, '89005924'],
    ['SHA-1', '12345678901234567890', 20000000000, '65353130'],
    ['SHA-256', '12345678901234567890123456789012', 59, '46119246'],
    ['SHA-256', '12345678901234567890123456789012', 1111111111, '67062674'],
    ['SHA-512', '1234567890123456789012345678901234567890123456789012345678901234', 59, '90693936'],
    ['SHA-512', '1234567890123456789012345678901234567890123456789012345678901234', 2000000000, '38618901'],
  ]
  for (const [algorithm, key, time, code] of cases)
    it(`${algorithm} at ${time}`, async () => {
      const p: OtpParams = { type: 'totp', secret: ascii(key), algorithm, digits: 8, period: 30, counter: 0 }
      expect((await currentCode(p, time * 1000)).code).toBe(code)
    })
})

describe('RFC 4226 (HOTP)', () => {
  it('matches the reference values', async () => {
    const p = { secret: ascii('12345678901234567890'), algorithm: 'SHA-1' as const, digits: 6 }
    const want = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489']
    for (let i = 0; i < want.length; i++) expect(await hotp(p, i)).toBe(want[i])
  })
})

describe('keys and links', () => {
  it('base32 round-trips and ignores spaces and case', () => {
    const bytes = ascii('Hello!')
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes)
    expect(base32Decode('jbsw y3dp ehpk 3pxp')).toEqual(base32Decode('JBSWY3DPEHPK3PXP'))
    expect(base32Decode('not base32!')).toBeNull()
  })
  it('parses keys and otpauth links', () => {
    expect(parseOtp('JBSW Y3DP EHPK 3PXP')).toMatchObject({ type: 'totp', digits: 6, period: 30, algorithm: 'SHA-1' })
    const p = parseOtp('otpauth://totp/GitHub:samb-dev?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&algorithm=SHA256&digits=8&period=60')!
    expect(p).toMatchObject({ issuer: 'GitHub', account: 'samb-dev', algorithm: 'SHA-256', digits: 8, period: 60 })
    expect(parseOtp(toOtpauth(p))).toEqual(p)
    expect(parseOtp('otpauth://hotp/Bank?secret=JBSWY3DPEHPK3PXP&counter=7')).toMatchObject({ type: 'hotp', counter: 7, account: 'Bank' })
    expect(parseOtp('otpauth://totp/x?secret=')).toBeNull()
    expect(parseOtp('hello')).toBeNull()
  })
  it('groups codes', () => {
    expect(groupCode('842091')).toBe('842 091')
    expect(groupCode('84209113')).toBe('8420 9113')
  })
})

// ---- a Google Authenticator export, encoded by hand ----

function varint(n: number): number[] {
  const out: number[] = []
  while (n > 127) {
    out.push((n % 128) | 128)
    n = Math.floor(n / 128)
  }
  out.push(n)
  return out
}
const field = (num: number, bytes: Uint8Array | number[]) => [...varint((num << 3) | 2), ...varint(bytes.length), ...bytes]
const num = (n: number, v: number) => [...varint(n << 3), ...varint(v)]
function account(secret: string, name: string, issuer: string, extra: number[] = []) {
  return new Uint8Array([...field(1, base32Decode(secret)!), ...field(2, ascii(name)), ...field(3, ascii(issuer)), ...num(4, 1), ...num(5, 1), ...num(6, 2), ...extra])
}
function migration(accounts: Uint8Array[], index = 0, size = 1) {
  const payload = new Uint8Array([...accounts.flatMap((a) => field(1, a)), ...num(2, 1), ...num(3, size), ...num(4, index), ...num(5, 42)])
  return `otpauth-migration://offline?data=${encodeURIComponent(toB64(payload))}`
}

describe('Google Authenticator export', () => {
  it('reads every account, splitting "Issuer:account"', () => {
    const b = parseMigration(migration([account('JBSWY3DPEHPK3PXP', 'GitHub:samb-dev', 'GitHub'), account('GEZDGNBVGY3TQOJQ', 'sam@example.com', 'Google')], 1, 3))!
    expect(b).toMatchObject({ index: 1, size: 3, id: 42, skipped: [] })
    expect(b.accounts.map((a) => [a.issuer, a.account, a.type, a.digits, base32Encode(a.secret)])).toEqual([
      ['GitHub', 'samb-dev', 'totp', 6, 'JBSWY3DPEHPK3PXP'],
      ['Google', 'sam@example.com', 'totp', 6, 'GEZDGNBVGY3TQOJQ'],
    ])
  })
  it('skips MD5 accounts and rejects other text', () => {
    const md5 = new Uint8Array([...field(1, base32Decode('JBSWY3DPEHPK3PXP')!), ...field(2, ascii('Old')), ...num(4, 4)])
    expect(parseMigration(migration([md5]))!.skipped).toEqual(['Old'])
    expect(parseMigration('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP')).toBeNull()
    expect(parseMigration('otpauth-migration://offline?data=%%%')).toBeNull()
  })
})

describe('matching an account to a saved login', () => {
  const login = (id: string, n: string, url: string, u = 'sam'): LoginItem => ({ id, ty: 'login', n, rd: 1, ct: 1, d: { u, p: 'x', urls: [{ u: url }] } })
  const items = [login('g', 'Google', 'https://accounts.google.com', 'sam@example.com'), login('h', 'GitHub', 'https://github.com', 'samb-dev'), login('w', 'Work GitHub', 'https://github.com', 'sam-work')]
  it('by issuer and site, preferring the same username', () => {
    expect(matchLogins({ issuer: 'Google', account: 'sam@example.com' }, items).map((i) => i.id)).toEqual(['g'])
    expect(matchLogins({ issuer: 'GitHub', account: 'samb-dev' }, items).map((i) => i.id)).toEqual(['h'])
    expect(matchLogins({ issuer: 'GitHub', account: 'someone' }, items).map((i) => i.id).sort()).toEqual(['h', 'w'])
    expect(matchLogins({ issuer: 'Dropbox', account: 'sam' }, items)).toEqual([])
  })
})
