import { create } from 'zustand'
import { isAndroid, Native } from '../native/android'
import { desktop } from '../native/desktop'

// Light / Dark / System (follows the device). The early script in index.html applies the saved
// choice before the first paint; this keeps it in sync afterwards. See DESIGN.md §2.

export type ThemeMode = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

const KEY = 'teledrive.theme'
const COLORS: Record<Theme, string> = { light: '#e6e6e3', dark: '#1f2023' }
const media = window.matchMedia('(prefers-color-scheme: dark)')

function saved(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

const resolve = (mode: ThemeMode): Theme => (mode === 'system' ? (media.matches ? 'dark' : 'light') : mode)

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLORS[theme])
  // The app's status bar follows this theme, not just the phone's
  if (isAndroid) Native.systemBars({ dark: theme === 'dark' }).catch(() => {})
}

export const useTheme = create<{ mode: ThemeMode; theme: Theme }>(() => {
  const mode = saved()
  return { mode, theme: resolve(mode) }
})

export function setThemeMode(mode: ThemeMode) {
  try {
    if (mode === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, mode)
  } catch {
    // Storage blocked: the choice lasts until the page closes
  }
  const theme = resolve(mode)
  useTheme.setState({ mode, theme })
  apply(theme)
  desktop?.setTheme(mode)
}

/** The theme button: System → Light → Dark → System. */
export function cycleTheme() {
  const next: Record<ThemeMode, ThemeMode> = { system: 'light', light: 'dark', dark: 'system' }
  setThemeMode(next[useTheme.getState().mode])
}

export const THEME_LABELS: Record<ThemeMode, string> = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' }

apply(useTheme.getState().theme)
// The desktop app's title bar follows the choice too
desktop?.setTheme(useTheme.getState().mode)
media.addEventListener('change', () => {
  if (useTheme.getState().mode !== 'system') return
  const theme = resolve('system')
  useTheme.setState({ theme })
  apply(theme)
})
