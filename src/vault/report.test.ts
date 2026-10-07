import { describe, expect, it } from 'vitest'
import { blankItem, type LoginItem, type VaultItem } from './items'
import { ageOf, buildReport } from './report'
import type { Score } from './strength'

const NOW = 1_800_000_000
const DAY = 86_400
const login = (id: string, p: string, extra: Partial<LoginItem> = {}): LoginItem => ({
  ...(blankItem('login', id) as LoginItem),
  n: id,
  ct: NOW - 10 * DAY,
  d: { u: 'sam', p, urls: [] },
  ...extra,
})
// Short passwords count as weak here (the real score comes from zxcvbn)
const score = (p: string): Score => (p.length < 8 ? 1 : 4)

describe('security report', () => {
  it('finds reused, weak and old passwords', () => {
    const items: VaultItem[] = [
      login('a', 'Same-Long-Password-1'),
      login('b', 'Same-Long-Password-1'),
      login('c', 'abc'),
      login('d', 'Unique-Long-Password-2', { pc: NOW - 400 * DAY }),
      login('e', 'Fine-Long-Password-3', { pc: NOW - 30 * DAY, ct: NOW - 900 * DAY }),
    ]
    const r = buildReport(items, score, NOW)
    expect(r.problems.get('a')).toEqual(['reused'])
    expect(r.sharedWith.get('a')).toEqual(['b'])
    expect(r.problems.get('c')).toEqual(['weak'])
    expect(r.problems.get('d')).toEqual(['old'])
    // Changed a month ago: not old, even though created long ago
    expect(r.problems.has('e')).toBe(false)
    expect(r.counts).toEqual({ reused: 2, weak: 1, old: 1 })
    expect(r.total).toBe(4)
  })

  it('uses the creation time when the password was never changed, and lists problems most serious first', () => {
    const r = buildReport([login('a', 'x', { ct: NOW - 500 * DAY }), login('b', 'x')], score, NOW)
    expect(r.problems.get('a')).toEqual(['reused', 'weak', 'old'])
  })

  it('leaves out the trash, logins without a password and other types', () => {
    const card = { ...blankItem('card', 'k'), n: 'Card' } as VaultItem
    const r = buildReport([login('a', 'x', { tr: NOW }), login('b', ''), login('c', 'x'), card], score, NOW)
    // "c" isn't reused: its twin is in the trash
    expect(r.problems.get('c')).toEqual(['weak'])
    expect(r.total).toBe(1)
  })

  it('scores each password once, with the username and name as hints', () => {
    const seen: string[][] = []
    buildReport([login('a', 'p1'), login('b', 'p1'), login('c', 'p2')], (p, inputs) => (seen.push([p, ...inputs]), 4), NOW)
    expect(seen).toEqual([['p1', 'sam', 'a'], ['p2', 'sam', 'c']])
  })

  it('says how old', () => {
    expect(ageOf(400 * DAY)).toBe('13 months')
    expect(ageOf(800 * DAY)).toBe('2 years')
  })
})
