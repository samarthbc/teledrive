import type { LoginItem, MatchMode, UrlEntry, VaultItem } from './items'

// Which saved logins fit the app or website being filled (IMPLEMENTATION.md → "Phase 23").

/** What Android asks to fill: a website (in a browser) or an app. */
export type FillTarget = { web: string } | { app: string }

/**
 * Suffixes under which anyone can register a name (a trimmed Public Suffix List): "x.co.in" is its own site, not part
 * of "co.in". Two-label suffixes only; everything else counts as a one-label suffix (".com", ".in").
 */
const SUFFIXES = new Set([
  'co.in', 'net.in', 'org.in', 'gov.in', 'ac.in', 'edu.in', 'res.in', 'nic.in', 'firm.in', 'gen.in', 'ind.in',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'org.nz', 'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'co.kr', 'or.kr',
  'com.br', 'com.cn', 'com.hk', 'com.sg', 'com.my', 'com.pk', 'com.bd', 'com.np', 'com.lk', 'com.ph', 'com.vn',
  'com.tr', 'com.mx', 'com.ar', 'com.co', 'com.eg', 'com.sa', 'co.za', 'co.id', 'co.th', 'co.il', 'com.ua',
  // Hosting where each subdomain is someone else's site
  'github.io', 'gitlab.io', 'blogspot.com', 'appspot.com', 'herokuapp.com', 'vercel.app', 'netlify.app', 'pages.dev',
  'web.app', 'firebaseapp.com', 'azurewebsites.net', 'cloudfront.net', 'onrender.com', 'fly.dev', 'workers.dev',
])

const APP_PREFIX = 'androidapp://'

/** The host of a saved website or a page ("" if it isn't one). Lower case, without a port's default. */
export function hostOf(url: string): string {
  const full = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`
  try {
    const u = new URL(full)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.host.toLowerCase() : ''
  } catch {
    return ''
  }
}

/** "accounts.google.com" → "google.com"; "x.co.in" → "x.co.in"; IP addresses and "localhost" stay as they are. */
export function baseDomain(host: string): string {
  const name = host.replace(/:\d+$/, '').replace(/\.$/, '')
  if (/^[\d.]+$/.test(name) || name.includes(':') || !name.includes('.')) return name
  const labels = name.split('.')
  const two = labels.slice(-2).join('.')
  return SUFFIXES.has(two) ? labels.slice(-3).join('.') : two
}

/** "com.instagram.android" → "instagram.com": the website an app's package name points to, if it looks like one. */
export function domainOfPackage(pkg: string): string | null {
  const labels = pkg.toLowerCase().split('.')
  if (labels.length < 2 || !['com', 'org', 'net', 'in', 'io', 'co', 'app', 'me'].includes(labels[0])) return null
  return `${labels[1]}.${labels[0]}`
}

/** Does one saved website fit the target? */
export function urlMatches(entry: UrlEntry, target: FillTarget): boolean {
  const mode: MatchMode = entry.m ?? 'base'
  if (mode === 'never') return false
  const saved = entry.u.trim()
  if (saved.toLowerCase().startsWith(APP_PREFIX)) return 'app' in target && saved.slice(APP_PREFIX.length).toLowerCase() === target.app.toLowerCase()
  // A regular expression isn't a website itself
  const savedHost = mode === 'regex' ? '' : hostOf(saved)
  if (!savedHost && mode !== 'regex') return false
  if ('app' in target) {
    // An app with no login saved for it: the website its package name points to (com.instagram.android → instagram.com)
    const site = domainOfPackage(target.app)
    return mode !== 'regex' && !!site && baseDomain(savedHost) === site
  }
  const pageHost = hostOf(target.web)
  if (!pageHost) return false
  const page = /^[a-z][a-z0-9+.-]*:\/\//i.test(target.web) ? target.web : `https://${target.web}/`
  switch (mode) {
    case 'base':
      return baseDomain(savedHost) === baseDomain(pageHost)
    case 'host':
      return savedHost === pageHost
    case 'starts':
      return page.toLowerCase().startsWith((/^[a-z][a-z0-9+.-]*:\/\//i.test(saved) ? saved : `https://${saved}`).toLowerCase())
    case 'exact':
      return page.toLowerCase().replace(/\/$/, '') === (/^[a-z][a-z0-9+.-]*:\/\//i.test(saved) ? saved : `https://${saved}`).toLowerCase().replace(/\/$/, '')
    case 'regex':
      try {
        return new RegExp(saved, 'i').test(page)
      } catch {
        return false
      }
  }
}

/**
 * The logins that fit, best first: an exact app match before a website guessed from the package name, then by name.
 */
export function matchingLogins(items: VaultItem[], target: FillTarget): LoginItem[] {
  const logins = items.filter((i): i is LoginItem => i.ty === 'login' && !i.tr)
  const direct = (l: LoginItem) => l.d.urls.some((u) => u.u.toLowerCase().startsWith(APP_PREFIX) && urlMatches(u, target))
  return logins
    .filter((l) => l.d.urls.some((u) => urlMatches(u, target)))
    .sort((a, b) => Number(direct(b)) - Number(direct(a)) || a.n.localeCompare(b.n))
}

/** What to call the target in the UI ("instagram.com", or the app's name/package). */
export function targetLabel(target: FillTarget, appName?: string): string {
  return 'web' in target ? hostOf(target.web) || target.web : appName || target.app
}

/** The website or app to save with a new login: "https://instagram.com" or "androidapp://com.instagram.android". */
export function targetUrl(target: FillTarget): string {
  return 'web' in target ? `https://${hostOf(target.web) || target.web}` : `${APP_PREFIX}${target.app}`
}
