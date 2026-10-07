// Password and passphrase generator (IMPLEMENTATION.md → "Phase 19.6"). Random from crypto.getRandomValues, without
// modulo bias.

export interface PasswordOptions {
  length: number
  upper: boolean
  lower: boolean
  digits: boolean
  symbols: boolean
  /** Leave out characters that look alike (l 1 I O 0 o). */
  avoidAmbiguous: boolean
}

export interface PassphraseOptions {
  words: number
  separator: string
  capitalize: boolean
  /** Add a digit to one word. */
  number: boolean
}

export const DEFAULT_PASSWORD: PasswordOptions = { length: 20, upper: true, lower: true, digits: true, symbols: true, avoidAmbiguous: false }
export const DEFAULT_PASSPHRASE: PassphraseOptions = { words: 5, separator: '-', capitalize: true, number: true }

export const MIN_LENGTH = 8
export const MAX_LENGTH = 64

const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*-_+=?',
}
const AMBIGUOUS = /[lI1O0o]/g

/** A uniformly random integer in [0, n). */
export function randomInt(n: number): number {
  const limit = Math.floor(0x100000000 / n) * n
  const buf = new Uint32Array(1)
  do crypto.getRandomValues(buf)
  while (buf[0] >= limit)
  return buf[0] % n
}

export function generatePassword(o: PasswordOptions = DEFAULT_PASSWORD): string {
  const sets = (['lower', 'upper', 'digits', 'symbols'] as const)
    .filter((k) => o[k])
    .map((k) => (o.avoidAmbiguous ? SETS[k].replace(AMBIGUOUS, '') : SETS[k]))
  if (!sets.length) sets.push(SETS.lower)
  const length = Math.max(Math.min(o.length, MAX_LENGTH), sets.length, 4)
  const all = sets.join('')
  // One from each chosen set, the rest from all of them, then shuffled
  const chars = sets.map((s) => s[randomInt(s.length)])
  while (chars.length < length) chars.push(all[randomInt(all.length)])
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

let words: Promise<string[]> | null = null
/** The EFF large wordlist (7,776 words: about 12.9 bits per word). */
export const wordlist = () => (words ??= import('./effWords').then((m) => m.default))

export async function generatePassphrase(o: PassphraseOptions = DEFAULT_PASSPHRASE): Promise<string> {
  const list = await wordlist()
  const picked = Array.from({ length: Math.max(3, Math.min(o.words, 20)) }, () => list[randomInt(list.length)])
  const out = picked.map((w) => (o.capitalize ? w[0].toUpperCase() + w.slice(1) : w))
  if (o.number) {
    const i = randomInt(out.length)
    out[i] += String(randomInt(10))
  }
  return out.join(o.separator)
}
