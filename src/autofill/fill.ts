import type { CardItem, IdentityItem, LoginItem, VaultItem } from '../vault/items'

// The fields Android found in the app or page being filled (AutofillParser.java names them the same way), and the
// values a chosen item gives them (IMPLEMENTATION.md → "Phase 23").

export type FieldKind =
  | 'username' | 'password'
  | 'ccNumber' | 'ccName' | 'ccExp' | 'ccExpMonth' | 'ccExpYear' | 'ccCvc'
  | 'name' | 'givenName' | 'familyName' | 'email' | 'phone' | 'address' | 'postal' | 'city' | 'state' | 'country'

const LOGIN: FieldKind[] = ['username', 'password']
const CARD: FieldKind[] = ['ccNumber', 'ccName', 'ccExp', 'ccExpMonth', 'ccExpYear', 'ccCvc']

/** What kind of item fits the form: a login form, a card form, or an address/contact form. */
export function formType(kinds: FieldKind[]): 'login' | 'card' | 'identity' {
  if (kinds.some((k) => LOGIN.includes(k))) return 'login'
  if (kinds.some((k) => CARD.includes(k))) return 'card'
  return 'identity'
}

export function parseKinds(list: string | null): FieldKind[] {
  const all: FieldKind[] = [...LOGIN, ...CARD, 'name', 'givenName', 'familyName', 'email', 'phone', 'address', 'postal', 'city', 'state', 'country']
  return (list ?? '').split(',').filter((k): k is FieldKind => all.includes(k as FieldKind))
}

/** The values for the fields this item can fill (fields it has nothing for are left out). */
export function valuesFor(item: VaultItem, kinds: FieldKind[]): Partial<Record<FieldKind, string>> {
  const out: Partial<Record<FieldKind, string>> = {}
  const put = (k: FieldKind, v: string | undefined) => {
    if (kinds.includes(k) && v) out[k] = v
  }
  if (item.ty === 'login') {
    const d = (item as LoginItem).d
    put('username', d.u)
    put('password', d.p)
  } else if (item.ty === 'card') {
    const d = (item as CardItem).d
    const [mm, yy] = d.exp.split('/').map((s) => s.trim())
    put('ccNumber', d.num.replace(/\s/g, ''))
    put('ccName', d.h)
    put('ccCvc', d.cvv)
    put('ccExp', mm && yy ? `${mm.padStart(2, '0')}/${yy.slice(-2)}` : d.exp)
    put('ccExpMonth', mm?.padStart(2, '0'))
    put('ccExpYear', yy ? (yy.length === 2 ? `20${yy}` : yy) : undefined)
  } else if (item.ty === 'identity') {
    const d = (item as IdentityItem).d
    put('name', [d.fn, d.mn, d.ln].filter(Boolean).join(' '))
    put('givenName', d.fn)
    put('familyName', d.ln)
    put('email', d.em)
    put('phone', d.ph)
    put('address', [d.a1, d.a2, d.a3].filter(Boolean).join(', '))
    put('postal', d.pin)
    put('city', d.city)
    put('state', d.st)
    put('country', d.ctry)
  }
  return out
}
