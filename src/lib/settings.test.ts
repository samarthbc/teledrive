import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, parseSettings } from './settings'

describe('parseSettings', () => {
  it('uses the defaults when nothing is saved or the data is damaged', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS)
  })
  it('keeps valid saved values', () => {
    const saved = { density: 'compact', thumbnails: false, autoLockMinutes: 15, lockOnClose: true }
    expect(parseSettings(JSON.stringify(saved))).toEqual(saved)
  })
  it('replaces invalid values with defaults, one by one', () => {
    const s = parseSettings(JSON.stringify({ density: 'huge', thumbnails: 'yes', autoLockMinutes: 7, lockOnClose: true }))
    expect(s).toEqual({ ...DEFAULT_SETTINGS, lockOnClose: true })
  })
})
