/**
 * Camera backup from a date range (Phase 18): which phone photos a backed-up folder covers. Kept apart from
 * backup.ts (no Capacitor) so it can be unit-tested.
 */

/** Photos taken between two times (unix seconds, both included). */
export interface DateRange {
  from: number
  to: number
}

/** `since` for a folder that backs up only its ranges, no new photos. */
export const NO_NEW = Number.MAX_SAFE_INTEGER

/** What the scope check needs from a folder and from a photo. */
interface Scoped {
  since: number
  ranges?: DateRange[]
}
interface Dated {
  /** Unix seconds. */
  dateAdded: number
  /** Unix ms. */
  dateTaken?: number
}

/** When a photo was taken (unix seconds), else when it was added to the phone. */
export function takenAt(i: Dated): number {
  return i.dateTaken ? Math.floor(i.dateTaken / 1000) : i.dateAdded
}

export function inRange(r: DateRange, i: Dated): boolean {
  const t = takenAt(i)
  return t >= r.from && t <= r.to
}

/** Does the folder back this photo up: added since it's been on, or taken in one of its ranges. */
export function inScope(source: Scoped, i: Dated): boolean {
  return i.dateAdded >= source.since || !!source.ranges?.some((r) => inRange(r, i))
}

/** Where to start listing the folder (by date added): ranges are by date taken, so from the start. */
export function listStart(source: Scoped): number {
  return source.ranges?.length ? 0 : source.since
}

/** "2024-08-12" → local midnight that day (unix seconds). */
function dayStart(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return Math.floor(new Date(y, m - 1, d).getTime() / 1000)
}

/** Two local days ("YYYY-MM-DD", both included) → a range. */
export function dayRange(from: string, to: string): DateRange {
  return { from: dayStart(from), to: dayStart(nextDay(to)) - 1 }
}

function nextDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return toDay(new Date(y, m - 1, d + 1))
}

/** A date → "YYYY-MM-DD" (local). */
export function toDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Quick picks for the date pickers. */
export function quickRanges(now = new Date()): { label: string; from: string; to: string }[] {
  const y = now.getFullYear()
  const ago = new Date(now)
  ago.setDate(ago.getDate() - 29)
  return [
    { label: 'Last 30 days', from: toDay(ago), to: toDay(now) },
    { label: 'This year', from: `${y}-01-01`, to: toDay(now) },
    { label: 'Last year', from: `${y - 1}-01-01`, to: `${y - 1}-12-31` },
  ]
}

/** "12 Aug 2024 – 20 Aug 2024", shorter when the ends share a year. */
export function rangeLabel(r: DateRange): string {
  const a = new Date(r.from * 1000)
  const b = new Date(r.to * 1000)
  const same = a.getFullYear() === b.getFullYear()
  const fmt = (d: Date, year: boolean) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(year && { year: 'numeric' }) })
  return `${fmt(a, !same)} – ${fmt(b, true)}`
}
