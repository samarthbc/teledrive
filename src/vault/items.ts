// TeleWarden's items: what's sealed in each item message (IMPLEMENTATION.md → "Phase 19.4").

export type ItemType = 'login' | 'card' | 'identity' | 'note'

/** How a saved website matches a page (Phase 23); base domain when missing. */
export type MatchMode = 'base' | 'host' | 'starts' | 'exact' | 'regex' | 'never'

export interface UrlEntry {
  u: string
  m?: MatchMode
}

export interface LoginData {
  /** Username or email. */
  u: string
  /** Password. */
  p: string
  /** 2FA secret or otpauth:// link (Phase 20). */
  otp?: string
  urls: UrlEntry[]
}

export interface CardData {
  /** Cardholder. */
  h: string
  num: string
  /** MM/YY. */
  exp: string
  cvv: string
}

export interface IdentityData {
  /** Title (Mr, Ms, Dr…). */
  ti?: string
  fn?: string
  mn?: string
  ln?: string
  em?: string
  ph?: string
  a1?: string
  a2?: string
  a3?: string
  city?: string
  st?: string
  /** PIN code. */
  pin?: string
  ctry?: string
  /** Aadhaar. */
  aad?: string
  pan?: string
  /** Passport. */
  pp?: string
  /** Driving licence. */
  dl?: string
  /** Voter ID. */
  vid?: string
  /** Username. */
  un?: string
  /** Company. */
  co?: string
}

export interface NoteData {
  t: string
}

export interface CustomField {
  k: string
  v: string
  /** Hidden (shown as dots until revealed). */
  h?: boolean
}

export interface OldPassword {
  p: string
  /** When it stopped being used (unix seconds). */
  d: number
}

interface Base {
  id: string
  /** Name. */
  n: string
  /** Folder ID. */
  f?: string
  fav?: boolean
  /** Trashed at (unix seconds). */
  tr?: number
  /** Revision: last saved (unix ms), for conflicts and rollbacks. */
  rd: number
  /** Created (unix seconds). */
  ct: number
  cf?: CustomField[]
  notes?: string
}

export type LoginItem = Base & { ty: 'login'; d: LoginData; /** Password changed (unix seconds). */ pc?: number; ph?: OldPassword[] }
export type CardItem = Base & { ty: 'card'; d: CardData }
export type IdentityItem = Base & { ty: 'identity'; d: IdentityData }
export type NoteItem = Base & { ty: 'note'; d: NoteData }
export type VaultItem = LoginItem | CardItem | IdentityItem | NoteItem

export interface VaultFolder {
  id: string
  n: string
  rd: number
}

export const TRASH_DAYS = 30
export const HISTORY_LENGTH = 5

export const TYPE_NAMES: Record<ItemType, { one: string; many: string }> = {
  login: { one: 'Login', many: 'Logins' },
  card: { one: 'Card', many: 'Cards' },
  identity: { one: 'Identity', many: 'Identities' },
  note: { one: 'Secure note', many: 'Notes' },
}

const nowSec = () => Math.floor(Date.now() / 1000)

/** A new, empty item of a type. */
export function blankItem(ty: ItemType, id: string): VaultItem {
  const base = { id, n: '', rd: Date.now(), ct: nowSec() }
  switch (ty) {
    case 'login':
      return { ...base, ty, d: { u: '', p: '', urls: [] } }
    case 'card':
      return { ...base, ty, d: { h: '', num: '', exp: '', cvv: '' } }
    case 'identity':
      return { ...base, ty, d: { ctry: 'India' } }
    case 'note':
      return { ...base, ty, d: { t: '' } }
  }
}

/** Saving a login whose password changed keeps the old one (the last few). */
export function withPasswordHistory(prev: VaultItem | undefined, next: VaultItem): VaultItem {
  if (next.ty !== 'login' || prev?.ty !== 'login' || !prev.d.p || prev.d.p === next.d.p) return next
  const ph = [{ p: prev.d.p, d: nowSec() }, ...(prev.ph ?? [])].slice(0, HISTORY_LENGTH)
  return { ...next, ph, pc: nowSec() }
}

// ---- cards ----

export function cardBrand(number: string): string {
  const n = number.replace(/\D/g, '')
  if (!n) return ''
  if (/^4/.test(n)) return 'Visa'
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(n)) return 'Mastercard'
  if (/^3[47]/.test(n)) return 'Amex'
  if (/^(60|65|81|82|508|353|356)/.test(n)) return 'RuPay'
  if (/^(6011|64[4-9])/.test(n)) return 'Discover'
  if (/^3(0[0-5]|[68])/.test(n)) return 'Diners Club'
  if (/^35/.test(n)) return 'JCB'
  return 'Card'
}

/** "4532 7781 0934 4421" (Amex: 4-6-5). */
export function groupCardNumber(number: string): string {
  const n = number.replace(/\D/g, '')
  if (/^3[47]/.test(n)) return [n.slice(0, 4), n.slice(4, 10), n.slice(10)].filter(Boolean).join(' ')
  return n.replace(/(.{4})(?=.)/g, '$1 ')
}

export const last4 = (number: string) => number.replace(/\D/g, '').slice(-4)

// ---- identity documents (India) ----

/** Problems with an identity's fields, by field (empty when fine). Empty fields are fine. */
export function identityProblems(d: IdentityData): Partial<Record<keyof IdentityData, string>> {
  const out: Partial<Record<keyof IdentityData, string>> = {}
  const digits = (s?: string) => (s ?? '').replace(/\s/g, '')
  if (d.aad && !/^[2-9]\d{11}$/.test(digits(d.aad))) out.aad = 'Aadhaar numbers have 12 digits'
  if (d.pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(digits(d.pan).toUpperCase())) out.pan = 'PAN looks like ABCDE1234F'
  if (d.pin && !/^[1-9]\d{5}$/.test(digits(d.pin))) out.pin = 'PIN codes have 6 digits'
  if (d.em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.em.trim())) out.em = 'That doesn’t look like an email address'
  return out
}

/** "XXXX XXXX 1234". */
export const maskAadhaar = (a: string) => {
  const n = a.replace(/\s/g, '')
  return n.length === 12 ? `XXXX XXXX ${n.slice(8)}` : a
}

export const fullName = (d: IdentityData) => [d.ti, d.fn, d.mn, d.ln].filter(Boolean).join(' ')

// ---- lists ----

/** The website's host, for display ("accounts.google.com"); Android apps as "Android app · <package>". */
export function hostOf(url: string): string {
  if (url.startsWith('androidapp://')) return `Android app · ${url.slice(13)}`
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`).host || url
  } catch {
    return url
  }
}

/** A link that opens in the browser, or null (Android apps, junk). */
export function openableUrl(url: string): string | null {
  if (url.startsWith('androidapp://')) return null
  const full = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`
  try {
    const u = new URL(full)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

/** The line under the name in lists. */
export function subtitleOf(item: VaultItem): string {
  switch (item.ty) {
    case 'login':
      return item.d.u || (item.d.urls[0] ? hostOf(item.d.urls[0].u) : '')
    case 'card':
      return item.d.num ? `${cardBrand(item.d.num)} •••• ${last4(item.d.num)}` : item.d.h
    case 'identity':
      return fullName(item.d) || item.d.em || ''
    case 'note':
      return item.d.t.split('\n')[0]
  }
}

/** Does the item match a search? (Name, username, websites, cardholder, email, name.) */
export function matchesSearch(item: VaultItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const fields: (string | undefined)[] = [item.n]
  if (item.ty === 'login') fields.push(item.d.u, ...item.d.urls.map((u) => u.u))
  if (item.ty === 'card') fields.push(item.d.h, cardBrand(item.d.num))
  if (item.ty === 'identity') fields.push(fullName(item.d), item.d.em, item.d.ph, item.d.co)
  return fields.some((f) => f?.toLowerCase().includes(q))
}

export const byName = (a: { n: string }, b: { n: string }) => a.n.localeCompare(b.n, undefined, { sensitivity: 'base' })
