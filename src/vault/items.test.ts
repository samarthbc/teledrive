import { describe, expect, it } from 'vitest'
import { blankItem, cardBrand, groupCardNumber, hostOf, identityProblems, maskAadhaar, matchesSearch, openableUrl, subtitleOf, withPasswordHistory, type LoginItem } from './items'
import { generatePassphrase, generatePassword, randomInt } from './generator'
import { masterRules } from './strength'

describe('cards', () => {
  it('detects brands, including RuPay', () => {
    expect(cardBrand('4532 7781 0934 4421')).toBe('Visa')
    expect(cardBrand('5412750012349087')).toBe('Mastercard')
    expect(cardBrand('2221000000000009')).toBe('Mastercard')
    expect(cardBrand('378282246310005')).toBe('Amex')
    expect(cardBrand('6521 1234 5678 9012')).toBe('RuPay')
    expect(cardBrand('6074 1234 5678 9012')).toBe('RuPay')
    expect(cardBrand('')).toBe('')
  })
  it('groups numbers (Amex 4-6-5)', () => {
    expect(groupCardNumber('4532778109344421')).toBe('4532 7781 0934 4421')
    expect(groupCardNumber('378282246310005')).toBe('3782 822463 10005')
  })
})

describe('identity', () => {
  it('checks Indian documents', () => {
    expect(identityProblems({ aad: '2345 6789 0123', pan: 'abcde1234f', pin: '560001', em: 'a@b.in' })).toEqual({})
    expect(identityProblems({ aad: '1234 5678 9012', pan: 'ABCD1234F', pin: '056001', em: 'nope' })).toEqual({
      aad: expect.any(String), pan: expect.any(String), pin: expect.any(String), em: expect.any(String),
    })
    expect(maskAadhaar('2345 6789 0123')).toBe('XXXX XXXX 0123')
  })
})

describe('logins', () => {
  const login = (p: string): LoginItem => ({ ...(blankItem('login', 'x') as LoginItem), n: 'Bank', d: { u: 'sam', p, urls: [{ u: 'https://bank.example' }] } })
  it('keeps old passwords when the password changes', () => {
    const a = login('one')
    const b = withPasswordHistory(a, login('two')) as LoginItem
    expect(b.ph?.map((h) => h.p)).toEqual(['one'])
    expect(b.pc).toBeGreaterThan(0)
    expect(withPasswordHistory(b, { ...b, n: 'Renamed' })).toEqual({ ...b, n: 'Renamed' })
    let c: LoginItem = b
    for (const p of ['3', '4', '5', '6', '7', '8']) c = withPasswordHistory(c, { ...c, d: { ...c.d, p } }) as LoginItem
    expect(c.ph).toHaveLength(5)
  })
  it('subtitle, search, hosts', () => {
    const l = login('pw')
    expect(subtitleOf(l)).toBe('sam')
    expect(matchesSearch(l, 'BANK.ex')).toBe(true)
    expect(matchesSearch(l, 'nope')).toBe(false)
    expect(hostOf('androidapp://com.kitebird.app')).toBe('Android app · com.kitebird.app')
    expect(hostOf('github.com/login')).toBe('github.com')
    expect(openableUrl('github.com')).toBe('https://github.com/')
    expect(openableUrl('javascript:alert(1)')).toBeNull()
    expect(openableUrl('androidapp://x')).toBeNull()
  })
})

describe('generator', () => {
  it('uses every chosen set and the length', () => {
    for (let i = 0; i < 50; i++) {
      const p = generatePassword({ length: 12, upper: true, lower: true, digits: true, symbols: true, avoidAmbiguous: true })
      expect(p).toHaveLength(12)
      expect(p).toMatch(/[A-Z]/)
      expect(p).toMatch(/[a-z]/)
      expect(p).toMatch(/\d/)
      expect(p).toMatch(/[^A-Za-z\d]/)
      expect(p).not.toMatch(/[lI1O0o]/)
    }
  })
  it('makes passphrases from the EFF list', async () => {
    const p = await generatePassphrase({ words: 5, separator: '-', capitalize: true, number: true })
    const words = p.split('-')
    expect(words).toHaveLength(5)
    expect(words.every((w) => /^[A-Z][a-z-]*\d?$/.test(w))).toBe(true)
    expect(p).toMatch(/\d/)
  })
  it('randomInt stays in range', () => {
    for (let i = 0; i < 1000; i++) expect(randomInt(7)).toBeLessThan(7)
  })
})

describe('master password rules', () => {
  it('needs length, strength, not the TeleDrive password, and a match', () => {
    expect(masterRules('short', 'short', 1, true).map((r) => r.ok)).toEqual([false, false, true, true])
    expect(masterRules('long enough pass', 'long enough pass', 3, false).map((r) => r.ok)).toEqual([true, true, false, true])
    expect(masterRules('long enough pass', 'long enough pas', 4, true).every((r) => r.ok)).toBe(false)
    expect(masterRules('long enough pass', 'long enough pass', 4, true).every((r) => r.ok)).toBe(true)
  })
})
