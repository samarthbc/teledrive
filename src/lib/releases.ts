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

export const downloadUrl = (p: Platform) => `https://github.com/${REPO}/releases/latest/download/${DOWNLOADS[p].file}`

export interface Release {
  version: string
  /** File name → size in bytes. */
  sizes: Record<string, number>
}

const CACHE_KEY = 'teledrive.release'
const CACHE_FOR = 24 * 60 * 60 * 1000

/** The newest release (checked at most once a day per device); null if there's none or GitHub can't be reached. */
export async function latestRelease(): Promise<Release | null> {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as { at: number; release: Release | null } | null
    if (cached && Date.now() - cached.at < CACHE_FOR) return cached.release
  } catch {
    // Storage blocked or bad data: just ask GitHub
  }
  let release: Release | null
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    if (res.status === 404) release = null // nothing released yet
    else if (!res.ok) return null // rate limit or outage: don't remember it
    else {
      const body = (await res.json()) as { tag_name: string; assets: { name: string; size: number }[] }
      release = { version: body.tag_name.replace(/^v/, ''), sizes: Object.fromEntries(body.assets.map((a) => [a.name, a.size])) }
    }
  } catch {
    return null
  }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), release }))
  } catch {
    // Fine: we'll ask again next time
  }
  return release
}

export function useLatestRelease(): Release | null {
  const [release, setRelease] = useState<Release | null>(null)
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
