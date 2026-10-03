import { describe, expect, it } from 'vitest'
import { dayRange, inScope, listStart, NO_NEW, quickRanges, takenAt, toDay } from './backupRange'

const at = (y: number, m: number, d: number, h = 12) => Math.floor(new Date(y, m - 1, d, h).getTime() / 1000)

describe('backup date range', () => {
  it('uses the date taken, else the date added', () => {
    expect(takenAt({ dateAdded: 500, dateTaken: 100_000 })).toBe(100)
    expect(takenAt({ dateAdded: 500 })).toBe(500)
  })

  it('includes both whole days', () => {
    const r = dayRange('2024-08-12', '2024-08-20')
    const src = { since: NO_NEW, ranges: [r] }
    const photo = (t: number) => ({ dateAdded: at(2026, 1, 1), dateTaken: t * 1000 })
    expect(inScope(src, photo(at(2024, 8, 12, 0)))).toBe(true)
    expect(inScope(src, photo(at(2024, 8, 20, 23) + 3599))).toBe(true)
    expect(inScope(src, photo(at(2024, 8, 21, 0)))).toBe(false)
    expect(inScope(src, photo(at(2024, 8, 11, 23)))).toBe(false)
  })

  it('a photo copied later counts by when it was taken', () => {
    const src = { since: NO_NEW, ranges: [dayRange('2024-01-01', '2024-12-31')] }
    expect(inScope(src, { dateAdded: at(2026, 5, 1), dateTaken: at(2024, 6, 1) * 1000 })).toBe(true)
    expect(inScope(src, { dateAdded: at(2024, 6, 1), dateTaken: at(2026, 5, 1) * 1000 })).toBe(false)
  })

  it('keeps new photos coming alongside a range', () => {
    const since = at(2026, 9, 1)
    const src = { since, ranges: [dayRange('2024-01-01', '2024-01-31')] }
    expect(inScope(src, { dateAdded: since + 10 })).toBe(true)
    expect(inScope(src, { dateAdded: at(2025, 3, 1) })).toBe(false)
    expect(listStart(src)).toBe(0)
    expect(listStart({ since })).toBe(since)
  })

  it('a range-only folder takes no new photos', () => {
    expect(inScope({ since: NO_NEW, ranges: [] }, { dateAdded: at(2026, 10, 1) })).toBe(false)
  })

  it('quick picks', () => {
    const now = new Date(2026, 9, 3)
    const [last30, thisYear, lastYear] = quickRanges(now)
    expect(last30).toMatchObject({ from: '2026-09-04', to: '2026-10-03' })
    expect(thisYear).toMatchObject({ from: '2026-01-01', to: '2026-10-03' })
    expect(lastYear).toMatchObject({ from: '2025-01-01', to: '2025-12-31' })
    expect(toDay(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})
