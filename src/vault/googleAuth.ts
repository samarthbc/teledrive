import { fromB64 } from '../drive/crypto'
import type { OtpAlgorithm, OtpParams } from './totp'

// Google Authenticator's "Transfer accounts → Export accounts" QR codes: otpauth-migration://offline?data=<base64>,
// where data is a protobuf MigrationPayload. Only varints and length-delimited fields occur, so a tiny reader does.
//
//   MigrationPayload { repeated OtpParameters otp_parameters = 1; int32 version = 2; int32 batch_size = 3;
//                      int32 batch_index = 4; int32 batch_id = 5; }
//   OtpParameters { bytes secret = 1; string name = 2; string issuer = 3; Algorithm algorithm = 4;
//                   DigitCount digits = 5; OtpType type = 6; int64 counter = 7; }

export interface MigrationBatch {
  accounts: OtpParams[]
  /** Several QR codes make one export: which one this is (0-based) and how many. */
  index: number
  size: number
  /** Same for every QR code of one export. */
  id: number
  /** Accounts that can't be used (e.g. MD5), by name. */
  skipped: string[]
}

class Reader {
  pos = 0
  constructor(private buf: Uint8Array) {}
  get done() {
    return this.pos >= this.buf.length
  }
  varint(): number {
    let result = 0
    let shift = 0
    for (;;) {
      if (this.pos >= this.buf.length) throw new Error('Truncated')
      const b = this.buf[this.pos++]
      // Counters can exceed 2^31: multiply instead of shifting
      result += (b & 0x7f) * 2 ** shift
      if (!(b & 0x80)) return result
      shift += 7
      if (shift > 63) throw new Error('Bad varint')
    }
  }
  bytes(): Uint8Array<ArrayBuffer> {
    const len = this.varint()
    if (this.pos + len > this.buf.length) throw new Error('Truncated')
    const out = this.buf.slice(this.pos, this.pos + len)
    this.pos += len
    return out as Uint8Array<ArrayBuffer>
  }
  skip(wire: number) {
    if (wire === 0) this.varint()
    else if (wire === 2) this.bytes()
    else if (wire === 1) this.pos += 8
    else if (wire === 5) this.pos += 4
    else throw new Error('Bad wire type')
  }
}

const dec = new TextDecoder()

function readAccount(buf: Uint8Array): { params?: OtpParams; name: string } {
  const r = new Reader(buf)
  let secret: Uint8Array<ArrayBuffer> = new Uint8Array(0)
  let name = ''
  let issuer = ''
  let algorithm = 1
  let digits = 1
  let type = 2
  let counter = 0
  while (!r.done) {
    const tag = r.varint()
    const field = tag >>> 3
    const wire = tag & 7
    if (field === 1 && wire === 2) secret = r.bytes()
    else if (field === 2 && wire === 2) name = dec.decode(r.bytes())
    else if (field === 3 && wire === 2) issuer = dec.decode(r.bytes())
    else if (field === 4 && wire === 0) algorithm = r.varint()
    else if (field === 5 && wire === 0) digits = r.varint()
    else if (field === 6 && wire === 0) type = r.varint()
    else if (field === 7 && wire === 0) counter = r.varint()
    else r.skip(wire)
  }
  // The name often repeats the issuer: "GitHub:samb-dev"
  let account = name
  if (issuer && name.toLowerCase().startsWith(`${issuer.toLowerCase()}:`)) account = name.slice(issuer.length + 1).trim()
  else if (!issuer && name.includes(':')) [issuer, account] = name.split(/:(.*)/s).map((s) => s.trim())
  const algo: Record<number, OtpAlgorithm> = { 0: 'SHA-1', 1: 'SHA-1', 2: 'SHA-256', 3: 'SHA-512' }
  if (!secret.length || !(algorithm in algo)) return { name: issuer || name }
  return {
    name: issuer || name,
    params: {
      type: type === 1 ? 'hotp' : 'totp',
      secret,
      algorithm: algo[algorithm],
      digits: digits === 2 ? 8 : 6,
      period: 30,
      counter,
      issuer: issuer || undefined,
      account: account || undefined,
    },
  }
}

/** Read one export QR code. Null if it isn't one. */
export function parseMigration(text: string): MigrationBatch | null {
  if (!/^otpauth-migration:\/\/offline\?/i.test(text.trim())) return null
  try {
    const data = new URL(text.trim()).searchParams.get('data')
    if (!data) return null
    // URLSearchParams turns "+" into spaces
    const r = new Reader(fromB64(data.replace(/ /g, '+')))
    const batch: MigrationBatch = { accounts: [], index: 0, size: 1, id: 0, skipped: [] }
    while (!r.done) {
      const tag = r.varint()
      const field = tag >>> 3
      const wire = tag & 7
      if (field === 1 && wire === 2) {
        const { params, name } = readAccount(r.bytes())
        if (params) batch.accounts.push(params)
        else batch.skipped.push(name)
      } else if (field === 3 && wire === 0) batch.size = Math.max(1, r.varint())
      else if (field === 4 && wire === 0) batch.index = r.varint()
      else if (field === 5 && wire === 0) batch.id = r.varint()
      else r.skip(wire)
    }
    return batch
  } catch {
    return null
  }
}
