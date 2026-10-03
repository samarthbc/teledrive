import { Calendar } from 'lucide-react'
import { useEffect, useState } from 'react'
import { countRange } from '../native/backup'
import { dayRange, quickRanges, toDay } from '../native/backupRange'

/** Camera backup from a date range: the dates being picked (local "YYYY-MM-DD", both days included). */
export interface Days {
  from: string
  to: string
}

/** The last 30 days, to start with. */
export function initialDays(): Days {
  const { from, to } = quickRanges()[0]
  return { from, to }
}

export function validDays(d: Days): boolean {
  return !!d.from && !!d.to && d.from <= d.to && d.to <= toDay(new Date())
}

/**
 * How many photos and videos in a phone folder were taken in the dates and aren't backed up yet, and their size.
 * Null while counting (or while the dates aren't valid).
 */
export function useRangeCount(path: string, days: Days): { count: { count: number; bytes: number } | null; error: string | null } {
  const valid = validDays(days)
  const [count, setCount] = useState<{ count: number; bytes: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setCount(null)
    setError(null)
    if (!valid) return
    let alive = true
    const t = setTimeout(() => {
      countRange(path, dayRange(days.from, days.to)).then(
        (c) => alive && setCount(c),
        (e) => alive && setError(e instanceof Error ? e.message : String(e)),
      )
    }, 300)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [path, days.from, days.to, valid])

  return { count, error }
}

/** A date as "30 Sept 2026" with a calendar icon; tapping it opens the phone's date picker. */
export function DateField(props: { label: string; value: string; min?: string; max?: string; onChange: (v: string) => void }) {
  const { label, value, min, max, onChange } = props
  const [y, m, d] = value.split('-').map(Number)
  const shown = value ? new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Pick a date'
  return (
    <label className="block min-w-0">
      <span className="field-label">{label}</span>
      <span className="relative flex h-13 items-center gap-2.5 rounded-md px-3.5 text-[15px] font-semibold pressed has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand">
        <Calendar className="size-4.5 shrink-0 text-muted" />
        <span className="truncate">{shown}</span>
        <input
          type="date"
          aria-label={label}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.value)}
        />
      </span>
    </label>
  )
}
