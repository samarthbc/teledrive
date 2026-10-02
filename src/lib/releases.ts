import { useEffect, useState } from 'react'

// App downloads and update checks, from GitHub Releases (see IMPLEMENTATION.md Phase 9).
// Every release carries the same file names, so "latest" links never change.

const REPO = 'samarthbc/teledrive'
export const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`
export const APP_VERSION: string = __APP_VERSION__

export const DOWNLOADS = {
  windows: { file: 'TeleDrive-Setup.exe', label: 'Windows', note: 'Windows 10 or 11. If Windows says "Unknown publisher", choose More info → Run anyway.' },
  android: { file: 'TeleDrive.apk', label: 'Android', note: 'Android 10 or newer. Allow your browser to install unknown apps when asked.' },
} as const
export type Platform = keyof typeof DOWNLOADS

/** GitHub's link to a file of the newest release, which downloads it straight away. */
export const githubDownloadUrl = (p: Platform) => `https://github.com/${REPO}/releases/latest/download/${DOWNLOADS[p].file}`
/**
 * The website's own download link (`/download/windows`), which vercel.json forwards to the GitHub file, so the
 * download starts without leaving the site. The dev server has no such route: GitHub's link there.
 */
export const downloadUrl = (p: Platform) => (import.meta.env.DEV ? githubDownloadUrl(p) : `/download/${p}`)

export interface Release {
  version: string
  /** File name → size in bytes. */
  sizes: Record<string, number>
  /** File name → SHA-256 (hex), when GitHub provides it. */
  sha256: Record<string, string>
}

const CACHE_KEY = 'teledrive.release'
const CACHE_FOR = 24 * 60 * 60 * 1000

/**
 * The newest release (checked at most once a day per device, or now with `fresh`); null if there's none, or
 * undefined if GitHub can't be reached.
 */
export async function latestRelease(fresh = false): Promise<Release | null | undefined> {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as { at: number; release: Release | null } | null
    // Only a found release is remembered: "none yet" is asked again, so the first release shows at once
    if (!fresh && cached?.release && Date.now() - cached.at < CACHE_FOR) return cached.release
  } catch {
    // Storage blocked or bad data: just ask GitHub
  }
  let release: Release | null
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    if (res.status === 404) release = null // nothing released yet
    else if (!res.ok) return undefined // rate limit or outage: don't remember it
    else {
      const body = (await res.json()) as { tag_name: string; assets: { name: string; size: number; digest?: string | null }[] }
      release = {
        version: body.tag_name.replace(/^v/, ''),
        sizes: Object.fromEntries(body.assets.map((a) => [a.name, a.size])),
        sha256: Object.fromEntries(
          body.assets.filter((a) => a.digest?.startsWith('sha256:')).map((a) => [a.name, a.digest!.slice('sha256:'.length)]),
        ),
      }
    }
  } catch {
    return undefined
  }
  try {
    if (release) localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), release }))
    else localStorage.removeItem(CACHE_KEY)
  } catch {
    // Fine: we'll ask again next time
  }
  return release
}

/** The newest release; null if there's none yet, undefined while checking or if GitHub can't be reached. */
export function useLatestRelease(): Release | null | undefined {
  const [release, setRelease] = useState<Release | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    void latestRelease().then((r) => live && setRelease(r))
    return () => {
      live = false
    }
  }, [])
  return release
}

/** True if version `a` is newer than `b` ("1.2.10" > "1.2.9"). */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d > 0
  }
  return false
}

/** The visitor's own system first. */
export function platformOrder(userAgent = navigator.userAgent): Platform[] {
  return /Android/i.test(userAgent) ? ['android', 'windows'] : ['windows', 'android']
}
