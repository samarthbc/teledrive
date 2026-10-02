import { afterEach, describe, expect, it, vi } from 'vitest'
import { setSetting } from '../lib/settings'
import { closeAllLocks, isLevelOpen, openLevel, touch } from './keyring'

const key = {} as CryptoKey

describe('auto-lock', () => {
  afterEach(() => {
    closeAllLocks()
    vi.useRealTimers()
  })

  it('locks unlocked items after the idle time chosen in Settings', () => {
    vi.useFakeTimers()
    setSetting('autoLockMinutes', 15)
    openLevel('folder-a', key)
    touch()
    vi.advanceTimersByTime(14 * 60 * 1000)
    expect(isLevelOpen('folder-a')).toBe(true)
    vi.advanceTimersByTime(60 * 1000)
    expect(isLevelOpen('folder-a')).toBe(false)
  })

  it('activity postpones it', () => {
    vi.useFakeTimers()
    setSetting('autoLockMinutes', 1)
    openLevel('folder-b', key)
    touch()
    vi.advanceTimersByTime(50 * 1000)
    touch()
    vi.advanceTimersByTime(50 * 1000)
    expect(isLevelOpen('folder-b')).toBe(true)
    vi.advanceTimersByTime(10 * 1000)
    expect(isLevelOpen('folder-b')).toBe(false)
  })
})
