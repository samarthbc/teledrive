import { create } from 'zustand'

// Settings (IMPLEMENTATION.md Phase 10). Per device, saved in localStorage so they're known before the first
// render (nothing jumps after loading). The theme has its own key (lib/theme.ts).

export type Density = 'comfortable' | 'compact'
export const AUTO_LOCK_CHOICES = [1, 5, 15, 30] as const
export type AutoLockMinutes = (typeof AUTO_LOCK_CHOICES)[number]
/** TeleWarden locks after this many idle minutes; 0 = only when TeleDrive closes. */
export const VAULT_LOCK_CHOICES = [1, 5, 15, 30, 0] as const
export type VaultLockMinutes = (typeof VAULT_LOCK_CHOICES)[number]
/** Copied passwords leave the clipboard after this many seconds; 0 = never. */
export const CLIPBOARD_CHOICES = [10, 30, 60, 0] as const
export type ClipboardSeconds = (typeof CLIPBOARD_CHOICES)[number]

export interface Settings {
  density: Density
  /** Download and show thumbnails (off: type icons only). */
  thumbnails: boolean
  /** Unlocked locked items lock again after this many idle minutes. */
  autoLockMinutes: AutoLockMinutes
  /** Don't remember the TeleDrive password on this device: ask for it every time TeleDrive starts. */
  lockOnClose: boolean
  vaultLockMinutes: VaultLockMinutes
  clipboardSeconds: ClipboardSeconds
  /** TeleWarden: 2FA codes next to each login in the list. */
  vaultCodesInList: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  density: 'comfortable', thumbnails: true, autoLockMinutes: 5, lockOnClose: false, vaultLockMinutes: 5, clipboardSeconds: 30, vaultCodesInList: true,
}

const KEY = 'teledrive.settings'

/** Saved settings, with defaults for anything missing or invalid. */
export function parseSettings(raw: string | null): Settings {
  let saved: Partial<Record<keyof Settings, unknown>> = {}
  try {
    saved = JSON.parse(raw ?? '{}') ?? {}
  } catch {
    // Damaged: defaults
  }
  const d = DEFAULT_SETTINGS
  return {
    density: saved.density === 'compact' ? 'compact' : d.density,
    thumbnails: typeof saved.thumbnails === 'boolean' ? saved.thumbnails : d.thumbnails,
    autoLockMinutes: AUTO_LOCK_CHOICES.includes(saved.autoLockMinutes as AutoLockMinutes)
      ? (saved.autoLockMinutes as AutoLockMinutes)
      : d.autoLockMinutes,
    lockOnClose: typeof saved.lockOnClose === 'boolean' ? saved.lockOnClose : d.lockOnClose,
    vaultLockMinutes: VAULT_LOCK_CHOICES.includes(saved.vaultLockMinutes as VaultLockMinutes)
      ? (saved.vaultLockMinutes as VaultLockMinutes)
      : d.vaultLockMinutes,
    clipboardSeconds: CLIPBOARD_CHOICES.includes(saved.clipboardSeconds as ClipboardSeconds)
      ? (saved.clipboardSeconds as ClipboardSeconds)
      : d.clipboardSeconds,
    vaultCodesInList: typeof saved.vaultCodesInList === 'boolean' ? saved.vaultCodesInList : d.vaultCodesInList,
  }
}

function load(): Settings {
  try {
    return parseSettings(localStorage.getItem(KEY))
  } catch {
    return DEFAULT_SETTINGS
  }
}

export const useSettings = create<Settings>(load)

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  useSettings.setState({ [key]: value } as Pick<Settings, K>)
  try {
    localStorage.setItem(KEY, JSON.stringify(useSettings.getState()))
  } catch {
    // Storage blocked: the change lasts until TeleDrive closes
  }
}

/** For code outside React. */
export const getSettings = () => useSettings.getState()
