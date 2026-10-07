import { fromB64, randomBytes, toB64, WrongPasswordError } from '../drive/crypto'
import { cardBrand, type VaultFolder, type VaultItem } from './items'

// Exporting (IMPLEMENTATION.md → "Phase 21.5") in Bitwarden's formats, so the files open in Bitwarden too and come
// back into TeleWarden with the importers. The password-protected file is Bitwarden's "password protected" export:
//   key = PBKDF2-SHA256(password, salt, 600k); enc/mac keys = HKDF-Expand(key, "enc"/"mac"); each value is
//   "2." + iv | AES-256-CBC ciphertext | HMAC-SHA256(iv + ciphertext), all base64.

const enc = new TextEncoder()
const dec = new TextDecoder()
export const EXPORT_ITERATIONS = 600_000

interface BwExport {
  encrypted: false
  folders: { id: string; name: string }[]
  items: object[]
}

/** The vault as Bitwarden's unencrypted .json (trash left out). */
export function toBitwardenJson(items: VaultItem[], folders: VaultFolder[]): BwExport {
  const used = new Set(items.map((i) => i.f).filter(Boolean))
  return {
    encrypted: false,
    folders: folders.filter((f) => used.has(f.id)).map((f) => ({ id: f.id, name: f.n })),
    items: items
      .filter((i) => !i.tr)
      .map((i) => {
        const common = {
          id: i.id, folderId: i.f ?? null, name: i.n, notes: i.notes ?? null, favorite: !!i.fav, reprompt: 0,
          fields: (i.cf ?? []).map((c) => ({ name: c.k, value: c.v, type: c.h ? 1 : 0, linkedId: null })),
          creationDate: new Date(i.ct * 1000).toISOString(), revisionDate: new Date(i.rd).toISOString(),
        }
        switch (i.ty) {
          case 'login':
            return {
              ...common, type: 1,
              login: { username: i.d.u, password: i.d.p, totp: i.d.otp ?? null, uris: i.d.urls.map((u) => ({ uri: u.u, match: null })), fido2Credentials: [] },
              passwordHistory: (i.ph ?? []).map((h) => ({ password: h.p, lastUsedDate: new Date(h.d * 1000).toISOString() })),
            }
          case 'note':
            return { ...common, type: 2, notes: i.d.t, secureNote: { type: 0 } }
          case 'card': {
            const [mm, yy] = i.d.exp.split('/')
            return { ...common, type: 3, card: { cardholderName: i.d.h, brand: cardBrand(i.d.num), number: i.d.num, expMonth: mm ? String(Number(mm)) : null, expYear: yy ? `20${yy}` : null, code: i.d.cvv } }
          }
          case 'identity': {
            const d = i.d
            return {
              ...common, type: 4,
              identity: {
                title: d.ti ?? null, firstName: d.fn ?? null, middleName: d.mn ?? null, lastName: d.ln ?? null, email: d.em ?? null, phone: d.ph ?? null,
                address1: d.a1 ?? null, address2: d.a2 ?? null, address3: d.a3 ?? null, city: d.city ?? null, state: d.st ?? null, postalCode: d.pin ?? null,
                country: d.ctry ?? null, passportNumber: d.pp ?? null, licenseNumber: d.dl ?? null, username: d.un ?? null, company: d.co ?? null,
                ssn: d.aad ?? d.pan ?? null,
              },
              // Fields Bitwarden has no place for
              fields: [
                ...common.fields,
                ...(d.aad && d.pan ? [{ name: 'PAN', value: d.pan, type: 1, linkedId: null }] : []),
                ...(d.vid ? [{ name: 'Voter ID', value: d.vid, type: 1, linkedId: null }] : []),
              ],
            }
          }
        }
      }),
  }
}

const csvCell = (v: string | undefined) => {
  const s = v ?? ''
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Bitwarden's CSV: logins and notes only (cards and identities don't fit). */
export function toCsv(items: VaultItem[], folders: VaultFolder[]): string {
  const name = (id?: string) => folders.find((f) => f.id === id)?.n ?? ''
  const head = 'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp'
  const rows = items
    .filter((i) => !i.tr && (i.ty === 'login' || i.ty === 'note'))
    .map((i) => {
      const fields = (i.cf ?? []).map((c) => `${c.k}: ${c.v}`).join('\n')
      const cells =
        i.ty === 'login'
          ? [name(i.f), i.fav ? '1' : '', 'login', i.n, i.notes, fields, '0', i.d.urls.map((u) => u.u).join(','), i.d.u, i.d.p, i.d.otp]
          : [name(i.f), i.fav ? '1' : '', 'note', i.n, i.ty === 'note' ? i.d.t : '', fields, '0', '', '', '', '']
      return cells.map(csvCell).join(',')
    })
  return [head, ...rows].join('\n') + '\n'
}

// ---- password-protected (Bitwarden's EncString type 2) ----

async function stretch(password: string, salt: string, iterations: number) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits'])
  const master = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations }, base, 256))
  const prk = await crypto.subtle.importKey('raw', master, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  // HKDF-Expand with one block: HMAC(prk, info || 0x01)
  const expand = async (info: string) => new Uint8Array(await crypto.subtle.sign('HMAC', prk, enc.encode(`${info}\x01`)))
  const [encRaw, macRaw] = await Promise.all([expand('enc'), expand('mac')])
  return {
    encKey: await crypto.subtle.importKey('raw', encRaw, 'AES-CBC', false, ['encrypt', 'decrypt']),
    macKey: await crypto.subtle.importKey('raw', macRaw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']),
  }
}

type Keys = Awaited<ReturnType<typeof stretch>>

async function encString(keys: Keys, plain: string): Promise<string> {
  const iv = randomBytes(16)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, keys.encKey, enc.encode(plain)))
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', keys.macKey, new Uint8Array([...iv, ...ct])))
  return `2.${toB64(iv)}|${toB64(ct)}|${toB64(mac)}`
}

async function decString(keys: Keys, value: string): Promise<string> {
  const m = /^2\.([^|]+)\|([^|]+)\|([^|]+)$/.exec(value)
  if (!m) throw new Error('This file isn’t a password-protected export')
  const [iv, ct, mac] = [fromB64(m[1]), fromB64(m[2]), fromB64(m[3])]
  if (!(await crypto.subtle.verify('HMAC', keys.macKey, mac, new Uint8Array([...iv, ...ct])))) throw new WrongPasswordError()
  return dec.decode(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, keys.encKey, ct))
}

/** A password-protected export of the JSON (Bitwarden's format). */
export async function protect(json: string, password: string, iterations = EXPORT_ITERATIONS): Promise<string> {
  const salt = toB64(randomBytes(16))
  const keys = await stretch(password, salt, iterations)
  return JSON.stringify(
    {
      encrypted: true,
      passwordProtected: true,
      salt,
      kdfType: 0,
      kdfIterations: iterations,
      encKeyValidation_DO_NOT_EDIT: await encString(keys, crypto.randomUUID()),
      data: await encString(keys, json),
    },
    null,
    2,
  )
}

/** Is this a password-protected export (ours or Bitwarden's)? */
export function isProtected(text: string): boolean {
  try {
    const o = JSON.parse(text)
    return o?.encrypted === true && o?.passwordProtected === true
  } catch {
    return false
  }
}

/** The JSON inside a password-protected export. Throws WrongPasswordError. */
export async function unprotect(text: string, password: string): Promise<string> {
  const o = JSON.parse(text) as { salt: string; kdfType: number; kdfIterations: number; encKeyValidation_DO_NOT_EDIT: string; data: string }
  if (o.kdfType !== 0) throw new Error('This file uses Argon2. Export it from Bitwarden with the default settings (PBKDF2) or as plain .json.')
  const keys = await stretch(password, o.salt, o.kdfIterations)
  await decString(keys, o.encKeyValidation_DO_NOT_EDIT)
  return decString(keys, o.data)
}

/** "teledrive-vault-2026-10-07.json" */
export function exportName(ext: 'json' | 'csv'): string {
  return `teledrive-vault-${new Date().toISOString().slice(0, 10)}.${ext}`
}
