import { blankItem, hostOf, type CardItem, type CustomField, type IdentityItem, type ItemType, type LoginItem, type NoteItem, type VaultItem } from './items'

// Importing from other password managers (IMPLEMENTATION.md → "Phase 21.4"). Every importer turns a file into items
// (with temporary IDs) and folder names; the dialog then sends them. Pure: no Telegram, no vault key.

export type ImportSource = 'bitwarden-json' | 'bitwarden-csv' | 'chrome' | 'firefox' | 'lastpass' | '1password' | 'keepass'

export const SOURCES: { id: ImportSource; label: string; ext: string; hint: string }[] = [
  { id: 'bitwarden-json', label: 'Bitwarden', ext: '.json', hint: 'Tools → Export vault → .json (not the encrypted one)' },
  { id: 'bitwarden-csv', label: 'Bitwarden', ext: '.csv', hint: 'Tools → Export vault → .csv' },
  { id: 'chrome', label: 'Chrome or Edge', ext: '.csv', hint: 'Password Manager → Settings → Export passwords' },
  { id: 'firefox', label: 'Firefox', ext: '.csv', hint: 'Passwords → ⋯ → Export passwords' },
  { id: 'lastpass', label: 'LastPass', ext: '.csv', hint: 'Advanced options → Export' },
  { id: '1password', label: '1Password', ext: '.csv', hint: 'File → Export → CSV' },
  { id: 'keepass', label: 'KeePass', ext: '.xml', hint: 'File → Export → KeePass XML (2.x)' },
]

export interface Imported {
  /** Items; `f` holds the folder's name until the dialog makes the folders. */
  items: VaultItem[]
  folders: string[]
}

let seq = 0
const tmpId = () => `imp${++seq}`
const nowSec = () => Math.floor(Date.now() / 1000)
const clean = (s: unknown) => (typeof s === 'string' ? s.trim() : s == null ? '' : String(s).trim())

function base<T extends ItemType>(ty: T, n: string, extra: { folder?: string; fav?: boolean; notes?: string; fields?: CustomField[] } = {}) {
  const item = blankItem(ty, tmpId())
  item.n = n || 'Untitled'
  item.ct = nowSec()
  if (extra.folder) item.f = extra.folder
  if (extra.fav) item.fav = true
  if (extra.notes) item.notes = extra.notes
  if (extra.fields?.length) item.cf = extra.fields
  return item
}

function login(n: string, u: string, p: string, urls: string[], extra: Parameters<typeof base>[2] & { otp?: string } = {}): LoginItem {
  const item = base('login', n || (urls[0] ? hostOf(urls[0]) : ''), extra) as LoginItem
  item.d = { u, p, urls: urls.filter(Boolean).map((u) => ({ u })), ...(extra.otp && { otp: extra.otp }) }
  return item
}

function note(n: string, t: string, extra: Parameters<typeof base>[2] = {}): NoteItem {
  const item = base('note', n, extra) as NoteItem
  item.d = { t }
  return item
}

// ---- CSV ----

/** RFC 4180: quoted fields, doubled quotes, newlines inside quotes; a BOM is dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((f) => f !== '')) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some((f) => f !== '')) rows.push(row)
  return rows
}

/** Rows as objects by the header row (header names lower-cased). */
function csvObjects(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text)
  if (!header) return []
  const keys = header.map((h) => h.trim().toLowerCase())
  return rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])))
}

function needColumns(rows: Record<string, string>[], cols: string[], what: string) {
  if (!rows.length) throw new Error('This file has no items')
  const missing = cols.filter((c) => !(c in rows[0]))
  if (missing.length) throw new Error(`This doesn’t look like a ${what} export (missing ${missing.join(', ')})`)
}

// ---- formats ----

function chrome(text: string): Imported {
  const rows = csvObjects(text)
  needColumns(rows, ['url', 'username', 'password'], 'Chrome or Edge')
  return { items: rows.map((r) => login(r.name, r.username, r.password, [r.url], { notes: r.note })), folders: [] }
}

function firefox(text: string): Imported {
  const rows = csvObjects(text)
  needColumns(rows, ['url', 'username', 'password'], 'Firefox')
  return { items: rows.map((r) => login('', r.username, r.password, [r.url])), folders: [] }
}

function lastpass(text: string): Imported {
  const rows = csvObjects(text)
  needColumns(rows, ['url', 'username', 'password', 'name'], 'LastPass')
  const folders = new Set<string>()
  const items = rows.map((r) => {
    const folder = r.grouping || undefined
    if (folder) folders.add(folder)
    const extra = { folder, fav: r.fav === '1' }
    // Secure notes have the URL "http://sn"
    if (r.url === 'http://sn') return note(r.name, r.extra, extra)
    return login(r.name, r.username, r.password, [r.url], { ...extra, notes: r.extra, otp: r.totp })
  })
  return { items, folders: [...folders] }
}

function onePassword(text: string): Imported {
  const rows = csvObjects(text)
  if (!rows.length) throw new Error('This file has no items')
  const col = (r: Record<string, string>, ...names: string[]) => names.map((n) => r[n]).find((v) => v) ?? ''
  if (!('password' in rows[0])) throw new Error('This doesn’t look like a 1Password export (missing password)')
  const items = rows.map((r) =>
    login(col(r, 'title', 'name'), col(r, 'username', 'login'), r.password, [col(r, 'url', 'website', 'urls')], {
      notes: col(r, 'notes', 'notesplain'),
      otp: col(r, 'otpauth', 'one-time password', 'otp'),
    }),
  )
  return { items, folders: [] }
}

function bitwardenCsv(text: string): Imported {
  const rows = csvObjects(text)
  needColumns(rows, ['type', 'name', 'login_username', 'login_password'], 'Bitwarden')
  const folders = new Set<string>()
  const items = rows.flatMap((r): VaultItem[] => {
    const folder = r.folder || undefined
    if (folder) folders.add(folder)
    const extra = { folder, fav: r.favorite === '1', notes: r.notes, fields: parseBitwardenFields(r.fields) }
    if (r.type === 'note') return [note(r.name, r.notes, { ...extra, notes: undefined })]
    if (r.type !== 'login') return []
    return [login(r.name, r.login_username, r.login_password, (r.login_uri || '').split(','), { ...extra, otp: r.login_totp })]
  })
  return { items, folders: [...folders] }
}

/** Bitwarden CSV custom fields: "name: value" lines. */
function parseBitwardenFields(s: string | undefined): CustomField[] | undefined {
  if (!s) return undefined
  return s.split('\n').filter(Boolean).map((line) => {
    const i = line.indexOf(': ')
    return i < 0 ? { k: line, v: '' } : { k: line.slice(0, i), v: line.slice(i + 2) }
  })
}

interface BwItem {
  type: number
  name?: string
  notes?: string | null
  favorite?: boolean
  folderId?: string | null
  fields?: { name?: string; value?: string; type?: number }[] | null
  login?: { username?: string; password?: string; totp?: string; uris?: { uri?: string }[] } | null
  card?: { cardholderName?: string; number?: string; expMonth?: string; expYear?: string; code?: string } | null
  identity?: Record<string, string | null> | null
  secureNote?: unknown
}

function bitwardenJson(text: string): Imported {
  let data: { encrypted?: boolean; folders?: { id: string; name: string }[]; items?: BwItem[] }
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('This isn’t a Bitwarden .json file')
  }
  if (data.encrypted) throw new Error('This export is encrypted. Export again from Bitwarden as “.json” (not “encrypted”).')
  if (!Array.isArray(data.items)) throw new Error('This isn’t a Bitwarden .json file')
  const folderName = new Map((data.folders ?? []).map((f) => [f.id, f.name]))
  const used = new Set<string>()
  const items = data.items.flatMap((b): VaultItem[] => {
    const folder = b.folderId ? folderName.get(b.folderId) : undefined
    if (folder) used.add(folder)
    const fields = b.fields?.map((f) => ({ k: clean(f.name), v: clean(f.value), ...(f.type === 1 && { h: true }) }))
    const extra = { folder, fav: !!b.favorite, notes: clean(b.notes), fields }
    switch (b.type) {
      case 1:
        return [login(clean(b.name), clean(b.login?.username), clean(b.login?.password), (b.login?.uris ?? []).map((u) => clean(u.uri)), { ...extra, otp: clean(b.login?.totp) })]
      case 2:
        return [note(clean(b.name), clean(b.notes), { ...extra, notes: undefined })]
      case 3: {
        const c = b.card ?? {}
        const item = base('card', clean(b.name), extra) as CardItem
        const yy = clean(c.expYear).slice(-2)
        const mm = clean(c.expMonth).padStart(2, '0')
        item.d = { h: clean(c.cardholderName), num: clean(c.number).replace(/\s/g, ''), exp: yy && mm !== '00' ? `${mm}/${yy}` : '', cvv: clean(c.code) }
        return [item]
      }
      case 4: {
        const i = b.identity ?? {}
        const item = base('identity', clean(b.name), extra) as IdentityItem
        item.d = {
          ti: clean(i.title), fn: clean(i.firstName), mn: clean(i.middleName), ln: clean(i.lastName), em: clean(i.email), ph: clean(i.phone),
          a1: clean(i.address1), a2: clean(i.address2), a3: clean(i.address3), city: clean(i.city), st: clean(i.state), pin: clean(i.postalCode),
          ctry: clean(i.country), pp: clean(i.passportNumber), dl: clean(i.licenseNumber), un: clean(i.username), co: clean(i.company),
        }
        // Bitwarden's SSN field: in India most people put Aadhaar or PAN there
        const ssn = clean(i.ssn)
        if (/^[A-Z]{5}\d{4}[A-Z]$/i.test(ssn)) item.d.pan = ssn.toUpperCase()
        else if (/^\d{4}\s?\d{4}\s?\d{4}$/.test(ssn)) item.d.aad = ssn
        else if (ssn) item.cf = [...(item.cf ?? []), { k: 'SSN', v: ssn, h: true }]
        for (const k of Object.keys(item.d) as (keyof typeof item.d)[]) if (!item.d[k]) delete item.d[k]
        return [item]
      }
      default:
        return []
    }
  })
  return { items, folders: [...used] }
}

/** KeePass 2 XML: groups become folders (the top group is left out), entries become logins. */
function keepass(text: string): Imported {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.querySelector('parsererror') || !doc.querySelector('KeePassFile')) throw new Error('This isn’t a KeePass XML file')
  const folders = new Set<string>()
  const items: VaultItem[] = []
  const walk = (group: Element, path: string[]) => {
    const name = group.querySelector(':scope > Name')?.textContent?.trim() ?? ''
    if (name === 'Recycle Bin') return
    const here = path.length ? [...path, name] : ['']
    const folder = here.filter(Boolean).join(' / ') || undefined
    for (const entry of group.querySelectorAll(':scope > Entry')) {
      const strings = new Map<string, string>()
      for (const s of entry.querySelectorAll(':scope > String'))
        strings.set(s.querySelector('Key')?.textContent ?? '', s.querySelector('Value')?.textContent ?? '')
      const standard = ['Title', 'UserName', 'Password', 'URL', 'Notes', 'otp']
      const fields = [...strings].filter(([k, v]) => !standard.includes(k) && v).map(([k, v]) => ({ k, v }))
      if (folder) folders.add(folder)
      items.push(login(strings.get('Title') ?? '', strings.get('UserName') ?? '', strings.get('Password') ?? '', [strings.get('URL') ?? ''], { folder, notes: strings.get('Notes'), fields, otp: strings.get('otp') }))
    }
    for (const g of group.querySelectorAll(':scope > Group')) walk(g, here)
  }
  const root = doc.querySelector('Root > Group')
  if (root) walk(root, [])
  return { items, folders: [...folders] }
}

const IMPORTERS: Record<ImportSource, (text: string) => Imported> = {
  'bitwarden-json': bitwardenJson,
  'bitwarden-csv': bitwardenCsv,
  chrome,
  firefox,
  lastpass,
  '1password': onePassword,
  keepass,
}

/** Read a file from another password manager. Throws with a message for the person if it doesn't fit. */
export function importFile(source: ImportSource, text: string): Imported {
  const out = IMPORTERS[source](text)
  // Empty rows (no name, username, password or website) are dropped
  out.items = out.items.filter((i) => i.ty !== 'login' || i.d.u || i.d.p || i.d.urls.length || i.n !== 'Untitled')
  for (const i of out.items) {
    if (!i.notes) delete i.notes
    if (i.ty === 'login' && !i.d.otp) delete i.d.otp
  }
  return out
}

/** Same type, name, username and first website host as an item already saved. */
export function isDuplicate(item: VaultItem, existing: VaultItem[]): boolean {
  const key = (i: VaultItem) =>
    [i.ty, i.n.toLowerCase(), i.ty === 'login' ? i.d.u.toLowerCase() : '', i.ty === 'login' && i.d.urls[0] ? hostOf(i.d.urls[0].u) : ''].join('\n')
  const k = key(item)
  return existing.some((e) => !e.tr && key(e) === k)
}
