import { hostOf, type LoginItem, type VaultItem } from './items'

// Which saved login a 2FA account belongs to (IMPLEMENTATION.md → "Phase 20.2"): its issuer against the login's
// name and website hosts ("Google" ↔ accounts.google.com); the same username wins when several fit.

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function fits(issuer: string, item: LoginItem): boolean {
  const want = norm(issuer)
  if (!want) return false
  if (norm(item.n).includes(want) || want.includes(norm(item.n))) return !!norm(item.n)
  return item.d.urls.some((u) => {
    const host = hostOf(u.u).toLowerCase()
    // Any label of the host: "accounts.google.com" fits "Google"
    return host.split('.').some((label) => norm(label) === want)
  })
}

/** Logins this account may belong to (best first). Empty: none. */
export function matchLogins(account: { issuer?: string; account?: string }, items: VaultItem[]): LoginItem[] {
  const issuer = account.issuer ?? ''
  const logins = items.filter((i): i is LoginItem => i.ty === 'login' && !i.tr && fits(issuer, i))
  const user = account.account?.toLowerCase()
  const same = logins.filter((i) => user && i.d.u.toLowerCase() === user)
  return same.length ? same : logins
}
