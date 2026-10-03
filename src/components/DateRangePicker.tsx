import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { countRange } from '../native/backup'
import { dayRange, quickRanges, toDay } from '../native/backupRange'
import { formatBytes } from '../lib/format'

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
 * Camera backup from a date range: From and To (both days included, none in the future), quick picks, and how many
 * photos and videos in the folder that is (not counting what's already backed up).
 */
export default function DateRangePicker(props: { path: string; value: Days; onChange: (d: Days) => void }) {
  const { path, value, onChange } = props
  const today = toDay(new Date())
  const valid = validDays(value)
  const [count, setCount] = useState<{ count: number; bytes: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setCount(null)
    setError(null)
    if (!valid) return
    let alive = true
    const t = setTimeout(() => {
      countRange(path, dayRange(value.from, value.to)).then(
        (c) => alive && setCount(c),
        (e) => alive && setError(e instanceof Error ? e.message : String(e)),
      )
    }, 300)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [path, value.from, value.to, valid])

  return (
    <div className="space-y-2.5">
      <div className="space-y-2">
        <label className="flex items-center gap-3">
          <span className="w-10 shrink-0 text-[13px] font-bold">From</span>
          <input
            type="date"
            className="input min-w-0 flex-1"
            value={value.from}
            max={value.to || today}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
          />
        </label>
        <label className="flex items-center gap-3">
          <span className="w-10 shrink-0 text-[13px] font-bold">To</span>
          <input
            type="date"
            className="input min-w-0 flex-1"
            value={value.to}
            min={value.from}
            max={today}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {quickRanges().map((q) => (
          <button
            key={q.label}
            type="button"
            className={`btn-ghost h-8 px-2.5 text-xs ${q.from === value.from && q.to === value.to ? 'font-bold text-brand-ink' : ''}`}
            onClick={() => onChange({ from: q.from, to: q.to })}
          >
            {q.label}
          </button>
        ))}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted">
        {!valid ? (
          'Pick a From date on or before the To date, neither in the future.'
        ) : error ? (
          error
        ) : count ? (
          count.count ? (
            `${count.count.toLocaleString()} ${count.count === 1 ? 'photo or video' : 'photos and videos'} to back up · ${formatBytes(count.bytes)}`
          ) : (
            'Nothing to back up in these dates (or it’s all backed up already)'
          )
        ) : (
          <>
            <Loader2 className="size-3.5 animate-spin" /> Counting…
          </>
        )}
      </p>
    </div>
  )
}
