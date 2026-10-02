import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('__APP_VERSION__', '1.0.0')
const { isNewer, platformOrder } = await import('./releases')

describe('isNewer', () => {
  it('compares versions number by number', () => {
    expect(isNewer('1.2.10', '1.2.9')).toBe(true)
    expect(isNewer('1.0.0', '1.0.0')).toBe(false)
    expect(isNewer('0.9.9', '1.0.0')).toBe(false)
    expect(isNewer('2.0', '1.9.9')).toBe(true)
  })
})

describe('platformOrder', () => {
  it('puts the visitor\'s system first', () => {
    expect(platformOrder('Mozilla/5.0 (Linux; Android 14; 23124RN87I)')[0]).toBe('android')
    expect(platformOrder('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')[0]).toBe('windows')
  })
})
