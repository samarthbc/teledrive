import type { LoginItem, VaultItem } from './items'
import type { Score } from './strength'

// The security report (IMPLEMENTATION.md → "Phase 22"): weak, reused and old passwords, worked out on this device
// from the open vault. Nothing is sent anywhere.

export type Problem = 'reused' | 'weak' | 'old'
/** Most serious first (the badge in the list shows the first one). */
export const PROBLEMS: Problem[] = ['reused', 'weak', 'old']

/** Not changed for this long counts as old. */
export const OLD_DAYS = 365

export interface Report {
  /** Logins (not in the trash, with a password) and their problems. */
  problems: Map<string, Problem[]>
  /** For a reused password: the other logins that use it. */
  sharedWith: Map<string, string[]>
  /** How many logins have each problem. */
  counts: Record<Problem, number>
  /** Logins with at least one problem. */
  total: number
}

/** `score`: the strength estimate (zxcvbn). `now`: unix seconds. */
export function buildReport(items: VaultItem[], score: (password: string, userInputs: string[]) => Score, now: number): Report {
  const logins = items.filter((i): i is LoginItem => i.ty === 'login' && !i.tr && !!i.d.p)
  const byPassword = new Map<string, string[]>()
  for (const l of logins) byPassword.set(l.d.p, [...(byPassword.get(l.d.p) ?? []), l.id])
  // The same password is scored once
  const scores = new Map<string, Score>()

  const problems = new Map<string, Problem[]>()
  const sharedWith = new Map<string, string[]>()
  const counts: Record<Problem, number> = { reused: 0, weak: 0, old: 0 }
  for (const l of logins) {
    const list: Problem[] = []
    const same = byPassword.get(l.d.p)!.filter((id) => id !== l.id)
    if (same.length) {
      list.push('reused')
      sharedWith.set(l.id, same)
    }
    let s = scores.get(l.d.p)
    if (s === undefined) scores.set(l.d.p, (s = score(l.d.p, [l.d.u, l.n].filter(Boolean))))
    if (s <= 1) list.push('weak')
    if (now - (l.pc ?? l.ct) > OLD_DAYS * 86_400) list.push('old')
    for (const p of list) counts[p]++
    if (list.length) problems.set(l.id, list)
  }
  return { problems, sharedWith, counts, total: problems.size }
}

/** "1 year", "2 years", "14 months". */
export function ageOf(seconds: number): string {
  const months = Math.floor(seconds / (30.44 * 86_400))
  if (months < 24) return `${months} month${months === 1 ? '' : 's'}`
  const years = Math.floor(months / 12)
  return `${years} years`
}
