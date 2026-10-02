import { getSettings, useSettings } from '../lib/settings'
import { openFileKey, type AccountConfig, type AccountKeys } from './crypto'

// Which keys are open right now (memory only):
// - the account keys (TeleDrive password), also remembered on the device by vault.ts
// - the lock keys of locked files/folders unlocked in this session; they close after the idle time chosen in
//   Settings (1-30 minutes, default 5)

/** Level ID of everything that isn't locked. Other levels are the IDs of locked items. */
export const ROOT_LEVEL = 'root'
const autoLockMs = () => getSettings().autoLockMinutes * 60 * 1000

let account: { keys: AccountKeys; config: AccountConfig } | null = null
const locks = new Map<string, CryptoKey>()
const listeners = new Set<() => void>()
let idleTimer: ReturnType<typeof setTimeout> | undefined

/** Called whenever keys open or close (the tree is rebuilt then). */
export function onKeysChanged(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function changed() {
  // Unwrapped file keys of closed levels go too
  for (const [wrapped, { level }] of fileKeys) if (!isLevelOpen(level)) fileKeys.delete(wrapped)
  for (const fn of listeners) fn()
}

const fileKeys = new Map<string, { level: string; key: Promise<CryptoKey> }>()

/** The key that decrypts a file's content (its level must be open). */
export function fileKeyOf(file: { fileKey?: string; level: string }): Promise<CryptoKey> {
  if (!file.fileKey) return Promise.reject(new Error('This file is not encrypted'))
  const hit = fileKeys.get(file.fileKey)
  if (hit) return hit.key
  let key: Promise<CryptoKey>
  try {
    key = openFileKey(requireLevelKey(file.level), file.fileKey)
  } catch (e) {
    return Promise.reject(e)
  }
  fileKeys.set(file.fileKey, { level: file.level, key })
  key.catch(() => fileKeys.delete(file.fileKey!))
  return key
}

export function setAccount(keys: AccountKeys | null, config: AccountConfig | null = null): void {
  account = keys && config ? { keys, config } : null
  if (!account) locks.clear()
  changed()
}

export function accountKeys(): AccountKeys | null {
  return account?.keys ?? null
}

export function accountConfig(): AccountConfig | null {
  return account?.config ?? null
}

export function hasAccountKeys(): boolean {
  return !!account
}

/** The key of a level, if it's open. */
export function levelKey(level: string): CryptoKey | undefined {
  if (level === ROOT_LEVEL) return account?.keys.root
  return locks.get(level)
}

export function isLevelOpen(level: string): boolean {
  return !!levelKey(level)
}

/** Like levelKey, but explains what to do when it's closed. */
export function requireLevelKey(level: string): CryptoKey {
  const key = levelKey(level)
  if (key) return key
  if (level === ROOT_LEVEL) throw new Error('Enter your TeleDrive password first')
  throw new Error('This item is locked. Unlock it first.')
}

export function openLevel(level: string, key: CryptoKey): void {
  locks.set(level, key)
  touch()
  changed()
}

/** Lock one item again (and anything unlocked inside it is unreachable until it's opened again). */
export function closeLevel(level: string): void {
  if (locks.delete(level)) changed()
}

export function closeAllLocks(): void {
  if (!locks.size) return
  locks.clear()
  changed()
}

export function openLockCount(): number {
  return locks.size
}

let holds = 0

/** Keep unlocked items open while something needs them (e.g. re-encrypting). Call the result to release. */
export function holdOpen(): () => void {
  holds++
  let released = false
  return () => {
    if (released) return
    released = true
    holds--
    touch()
  }
}

/** User activity: postpones the automatic re-lock. */
export function touch(): void {
  clearTimeout(idleTimer)
  if (locks.size) idleTimer = setTimeout(() => (holds ? touch() : closeAllLocks()), autoLockMs())
}

/** Re-lock unlocked items after a few minutes without activity. */
export function initAutoLock(): void {
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart'])
    window.addEventListener(ev, touch, { passive: true, capture: true })
  // A new idle time counts from now
  useSettings.subscribe((s, prev) => s.autoLockMinutes !== prev.autoLockMinutes && touch())
}
