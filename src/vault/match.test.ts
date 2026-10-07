import { describe, expect, it } from 'vitest'
import { blankItem, type LoginItem, type UrlEntry } from './items'
import { baseDomain, domainOfPackage, matchingLogins, targetUrl, urlMatches } from './match'

const web = (w: string) => ({ web: w })
const app = (a: string) => ({ app: a })
const login = (id: string, urls: UrlEntry[], extra: Partial<LoginItem> = {}): LoginItem => ({
  ...(blankItem('login', id) as LoginItem),
  n: id,
  d: { u: 'sam', p: 'pw', urls },
  ...extra,
})

describe('base domains', () => {
  it('keeps the registrable part', () => {
    expect(baseDomain('accounts.google.com')).toBe('google.com')
    expect(baseDomain('www.irctc.co.in')).toBe('irctc.co.in')
    expect(baseDomain('netbanking.hdfcbank.com')).toBe('hdfcbank.com')
    expect(baseDomain('sam.github.io')).toBe('sam.github.io')
    expect(baseDomain('192.168.1.1')).toBe('192.168.1.1')
    expect(baseDomain('localhost:8080')).toBe('localhost')
  })

  it('guesses a website from a package name', () => {
    expect(domainOfPackage('com.instagram.android')).toBe('instagram.com')
    expect(domainOfPackage('in.amazon.mShop.android.shopping')).toBe('amazon.in')
    expect(domainOfPackage('nopackage')).toBeNull()
    expect(domainOfPackage('xyz.weird.app')).toBeNull()
  })
})

describe('matching a saved website', () => {
  it('base domain (the default): any subdomain of the same site', () => {
    expect(urlMatches({ u: 'https://accounts.google.com' }, web('mail.google.com'))).toBe(true)
    expect(urlMatches({ u: 'google.com' }, web('https://www.google.com/login'))).toBe(true)
    expect(urlMatches({ u: 'https://google.com' }, web('google.co.in'))).toBe(false)
    // co.in: different owners
    expect(urlMatches({ u: 'https://irctc.co.in' }, web('evil.co.in'))).toBe(false)
    // Look-alike hosts don't match
    expect(urlMatches({ u: 'https://google.com' }, web('google.com.evil.net'))).toBe(false)
  })

  it('host, starts with, exact, regular expression, never', () => {
    expect(urlMatches({ u: 'https://mail.google.com', m: 'host' }, web('mail.google.com'))).toBe(true)
    expect(urlMatches({ u: 'https://mail.google.com', m: 'host' }, web('accounts.google.com'))).toBe(false)
    expect(urlMatches({ u: 'https://example.com', m: 'starts' }, web('https://example.com/login'))).toBe(true)
    expect(urlMatches({ u: 'https://example.com/admin', m: 'starts' }, web('https://example.com/login'))).toBe(false)
    expect(urlMatches({ u: 'https://example.com/', m: 'exact' }, web('example.com'))).toBe(true)
    expect(urlMatches({ u: '^https://(www\\.)?example\\.org', m: 'regex' }, web('www.example.org'))).toBe(true)
    expect(urlMatches({ u: '([', m: 'regex' }, web('example.org'))).toBe(false)
    expect(urlMatches({ u: 'https://google.com', m: 'never' }, web('google.com'))).toBe(false)
  })

  it('apps: by package, or the website the package name points to', () => {
    expect(urlMatches({ u: 'androidapp://com.instagram.android' }, app('com.instagram.android'))).toBe(true)
    expect(urlMatches({ u: 'androidapp://com.instagram.android' }, app('com.facebook.katana'))).toBe(false)
    expect(urlMatches({ u: 'androidapp://com.instagram.android' }, web('instagram.com'))).toBe(false)
    expect(urlMatches({ u: 'https://www.instagram.com' }, app('com.instagram.android'))).toBe(true)
    expect(urlMatches({ u: 'https://www.instagram.com', m: 'never' }, app('com.instagram.android'))).toBe(false)
  })
})

describe('matching logins', () => {
  it('lists the logins that fit, the ones saved for the app first; leaves out the trash and other types', () => {
    const items = [
      login('Instagram (site)', [{ u: 'https://instagram.com' }]),
      login('Instagram (app)', [{ u: 'androidapp://com.instagram.android' }]),
      login('Old', [{ u: 'https://instagram.com' }], { tr: 1 }),
      login('Google', [{ u: 'https://google.com' }]),
      { ...blankItem('card', 'c'), n: 'Card' },
    ]
    expect(matchingLogins(items, app('com.instagram.android')).map((l) => l.n)).toEqual(['Instagram (app)', 'Instagram (site)'])
    expect(matchingLogins(items, web('www.google.com')).map((l) => l.n)).toEqual(['Google'])
  })

  it('saves a new login with the site or the app', () => {
    expect(targetUrl(web('https://www.example.com/login'))).toBe('https://www.example.com')
    expect(targetUrl(app('com.instagram.android'))).toBe('androidapp://com.instagram.android')
  })
})
