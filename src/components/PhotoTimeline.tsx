import { Check, Star } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { photoDate } from '../drive/photos'
import type { FileItem } from '../drive/tree'
import Thumb from './Thumb'

export { photoDate, sortPhotos, timelineItems } from '../drive/photos'

interface Group {
  key: string
  label: string
  /** Index of its first photo in the whole list. */
  start: number
  items: FileItem[]
}

const PAGE = 240

/**
 * TelePhotos' timeline: photos by the day they were taken, newest first, as square tiles. Only the first few hundred
 * are rendered; more follow while scrolling (the scrubber jumps further). Thumbnails load as they come into view.
 */
export default function PhotoTimeline(props: {
  items: FileItem[]
  selected: Set<string>
  /** The element that scrolls (for loading more and the scrubber). */
  scroller: React.RefObject<HTMLDivElement | null>
  onClick: (item: FileItem, e: React.MouseEvent) => void
  onToggle: (item: FileItem) => void
  onSelectMany: (ids: string[], on: boolean) => void
  onMenu: (item: FileItem, x: number, y: number) => void
  /** Show the selection circles even before anything is selected (picking photos). */
  selecting?: boolean
}) {
  const { items, selected, scroller, onClick, onToggle, onSelectMany, onMenu } = props
  const [limit, setLimit] = useState(PAGE)
  const sentinel = useRef<HTMLDivElement>(null)
  const pointer = useRef('mouse')
  const groupEls = useRef(new Map<string, HTMLElement>())
  const selecting = selected.size > 0 || !!props.selecting
  const groups = useMemo(() => groupByDay(items), [items])

  // The groups rendered so far: whole days, until about `limit` photos
  const shown = useMemo(() => {
    const out: Group[] = []
    for (const g of groups) {
      if (g.start >= limit) break
      out.push(g)
    }
    return out
  }, [groups, limit])

  // Near the end of what's rendered: render more
  useEffect(() => {
    const el = sentinel.current
    if (!el || shown.length === groups.length) return
    const observer = new IntersectionObserver(([e]) => e.isIntersecting && setLimit((l) => l + PAGE), {
      root: scroller.current,
      rootMargin: '1500px',
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [shown.length, groups.length, scroller])

  /** Jump to the photo at `index` (from the scrubber). */
  const [jumpTo, setJumpTo] = useState<number | null>(null)
  const jump = (index: number) => {
    setLimit((l) => Math.max(l, index + PAGE))
    setJumpTo(index)
  }
  useLayoutEffect(() => {
    if (jumpTo === null) return
    const g = [...groups].reverse().find((x) => x.start <= jumpTo)
    const el = g && groupEls.current.get(g.key)
    const box = scroller.current
    if (el && box) box.scrollTop = el.offsetTop - box.offsetTop - 8
    setJumpTo(null)
  }, [jumpTo, groups, scroller])

  return (
    <div className="relative">
      {shown.map((g) => {
        const allOn = g.items.every((i) => selected.has(i.id))
        return (
          <section
            key={g.key}
            ref={(el) => {
              if (el) groupEls.current.set(g.key, el)
              else groupEls.current.delete(g.key)
            }}
            data-start={g.start}
            className="mb-5"
          >
            <div className="group mb-2 flex items-center gap-2">
              <h2 className="text-[15px] font-extrabold tracking-[-0.01em]">{g.label}</h2>
              <button
                className={`flex size-6 items-center justify-center rounded-full transition-opacity ${
                  allOn ? 'bg-brand text-white' : 'text-muted raised-xs'
                } ${selecting ? '' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}`}
                onClick={() => onSelectMany(g.items.map((i) => i.id), !allOn)}
                aria-label={allOn ? `Unselect ${g.label}` : `Select ${g.label}`}
              >
                <Check className="size-3.5" strokeWidth={3} />
              </button>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-1 md:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] md:gap-1.5">
              {g.items.map((item) => {
                const on = selected.has(item.id)
                return (
                  <button
                    key={item.id}
                    className="relative aspect-square overflow-hidden rounded-[4px] bg-surface pressed-xs"
                    onPointerDown={(e) => (pointer.current = e.pointerType)}
                    onClick={(e) => onClick(item, e)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      // Long-press on touch screens selects, like in phone gallery apps
                      if (pointer.current === 'touch') onToggle(item)
                      else onMenu(item, e.clientX, e.clientY)
                    }}
                    aria-label={item.name}
                    aria-pressed={selecting ? on : undefined}
                  >
                    <span className={`block h-full w-full transition-transform duration-120 ${on ? 'scale-[0.86]' : ''}`}>
                      <Thumb item={item} iconClass="size-7" />
                    </span>
                    {item.x.fav && (
                      <Star className="absolute bottom-1 left-1 size-3.5 fill-white text-white drop-shadow" strokeWidth={2} />
                    )}
                    {selecting && (
                      <span
                        className={`absolute top-1 left-1 flex size-5 items-center justify-center rounded-full border-2 ${
                          on ? 'border-brand bg-brand text-white' : 'border-white bg-black/20'
                        }`}
                      >
                        {on && <Check className="size-3" strokeWidth={3.5} />}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
      <div ref={sentinel} className="h-px" />
      {items.length > 60 && <Scrubber groups={groups} total={items.length} scroller={scroller} onJump={jump} />}
    </div>
  )
}

/**
 * A rail on the right: drag it to jump through the years. The position stands for the photo's place in the list
 * (not pixels), since only part of the timeline is rendered.
 */
function Scrubber(props: { groups: Group[]; total: number; scroller: React.RefObject<HTMLDivElement | null>; onJump: (i: number) => void }) {
  const { groups, total, scroller, onJump } = props
  const rail = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ top: number; height: number; right: number } | null>(null)
  const [pos, setPos] = useState(0)
  const [drag, setDrag] = useState<{ frac: number; label: string } | null>(null)
  const [active, setActive] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Sits over the scrolling area's right edge (above the phone tabs). Measured after mounting: the scrolling
  // element's ref is only set once its children (this) are in place.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const place = () => {
      const r = el.getBoundingClientRect()
      const bottom = window.innerWidth < 768 ? 104 : 12
      // Inside the element's own scrollbar (desktop browsers draw one)
      const bar = el.offsetWidth - el.clientWidth
      setBox({ top: r.top + 12, height: Math.max(80, r.height - 12 - bottom), right: window.innerWidth - r.right + bar + 2 })
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(el)
    window.addEventListener('resize', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [scroller])

  // Follow normal scrolling: the first day at the top
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const top = el.scrollTop + el.offsetTop
        let start = 0
        for (const s of el.querySelectorAll<HTMLElement>('section[data-start]')) {
          if (s.offsetTop > top + 40) break
          start = Number(s.dataset.start)
        }
        setPos(start / Math.max(1, total - 1))
        setActive(true)
        clearTimeout(hideTimer.current)
        hideTimer.current = setTimeout(() => setActive(false), 1500)
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [scroller, total])

  const years = useMemo(() => {
    const out: { year: number; frac: number }[] = []
    let last = -1
    for (const g of groups) {
      const y = new Date(g.items[0] ? photoDate(g.items[0]) * 1000 : 0).getFullYear()
      if (y !== last) out.push({ year: y, frac: g.start / Math.max(1, total - 1) })
      last = y
    }
    // Labels too close together overlap: keep every one that has room
    return out.filter((y, i) => i === 0 || y.frac - out[i - 1].frac > 0.05)
  }, [groups, total])

  const pick = (clientY: number) => {
    const r = rail.current?.getBoundingClientRect()
    if (!r) return
    const frac = Math.min(1, Math.max(0, (clientY - r.top) / r.height))
    const index = Math.round(frac * (total - 1))
    const g = [...groups].reverse().find((x) => x.start <= index) ?? groups[0]
    const d = new Date(photoDate(g.items[0]) * 1000)
    setDrag({ frac, label: d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) })
    setPos(frac)
    onJump(index)
  }

  if (!box) return null
  const shown = active || !!drag
  return (
    <div
      ref={rail}
      className={`fixed z-10 w-7 touch-none transition-opacity duration-200 select-none ${shown ? 'opacity-100' : 'opacity-0 hover:opacity-100'}`}
      style={{ top: box.top, height: box.height, right: box.right }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        pick(e.clientY)
      }}
      onPointerMove={(e) => drag && pick(e.clientY)}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
      role="scrollbar"
      aria-orientation="vertical"
      aria-valuenow={Math.round(pos * 100)}
      aria-label="Jump to a date"
    >
      {years.map((y) => (
        <span
          key={y.year}
          className="pointer-events-none absolute right-8 hidden -translate-y-1/2 text-[11px] font-bold text-muted md:block"
          style={{ top: `${y.frac * 100}%` }}
        >
          {y.year}
        </span>
      ))}
      <span
        className="absolute right-1 h-9 w-2.5 -translate-y-1/2 rounded-[3px] bg-ink/70"
        style={{ top: `${pos * 100}%` }}
      />
      {drag && (
        <span
          className="absolute right-6 -translate-y-1/2 rounded-md bg-surface px-3 py-1.5 text-sm font-extrabold whitespace-nowrap raised-md"
          style={{ top: `${drag.frac * 100}%` }}
        >
          {drag.label}
        </span>
      )}
    </div>
  )
}

function groupByDay(items: FileItem[]): Group[] {
  const groups: Group[] = []
  const now = new Date()
  const today = dayKey(now)
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  items.forEach((item, index) => {
    const d = new Date(photoDate(item) * 1000)
    const key = dayKey(d)
    const last = groups[groups.length - 1]
    if (last?.key === key) return void last.items.push(item)
    const label =
      key === today
        ? 'Today'
        : key === yesterday
          ? 'Yesterday'
          : d.toLocaleDateString(undefined, {
              weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
            })
    groups.push({ key, label, start: index, items: [item] })
  })
  return groups
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
