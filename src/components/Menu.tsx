import type { LucideIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useBackHandler } from '../native/backButton'

export interface MenuEntry {
  label: string
  icon: LucideIcon
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

export interface MenuHeader {
  title: string
  subtitle?: string
  icon?: React.ReactNode
}

/** Phones get a bottom sheet instead of a popup (easier to reach, room for the item's name). */
const isPhone = () => window.innerWidth < 640

/** Popup menu at screen coordinates (right-click, long-press, or a "more" button). */
export default function Menu(props: { x: number; y: number; entries: MenuEntry[]; onClose: () => void; header?: MenuHeader }) {
  const { x, y, entries, onClose, header } = props
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const [sheet] = useState(isPhone)
  useBackHandler(true, onClose)

  // Keep the menu inside the viewport
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || sheet) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, y + height > window.innerHeight - 8 ? y - height : y),
    })
  }, [x, y, sheet])

  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if ((e.type === 'mousedown' || e.type === 'scroll') && ref.current?.contains(e.target as Node)) return
      onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [onClose])

  const items = entries.map((e, i) => (
    <div key={e.label}>
      {/* Destructive actions sit apart, after a rule */}
      {e.danger && i > 0 && !entries[i - 1].danger && <div className="mx-1 my-1.5 h-0.5 bg-line" />}
      <button
        role="menuitem"
        disabled={e.disabled}
        onClick={() => {
          onClose()
          e.onClick()
        }}
        className={`flex w-full items-center rounded-md text-left transition-[box-shadow] duration-120 outline-none hover:pressed-xs focus-visible:pressed-xs disabled:opacity-40 disabled:hover:shadow-none [&_svg]:shrink-0 ${
          sheet ? 'h-12 gap-4 px-3.5 text-[15px] [&_svg]:size-5' : 'h-10 gap-3 px-3 text-sm [&_svg]:size-[17px]'
        } ${e.danger ? 'font-bold text-brand-ink' : 'font-semibold'}`}
      >
        <e.icon />
        {e.label}
      </button>
    </div>
  ))

  if (sheet)
    return (
      <div className="fixed inset-0 z-50 bg-scrim" onContextMenu={(e) => e.preventDefault()}>
        <div
          ref={ref}
          role="menu"
          className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-surface px-2 pt-2.5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_-10px_30px_rgba(0,0,0,0.18)]"
        >
          <div className="mx-auto mb-3 h-1.25 w-10 rounded-full pressed-xs" aria-hidden />
          {header && (
            <div className="mx-2 mb-2 flex items-center gap-3 border-b-2 border-ink px-2 pb-3.5">
              {header.icon}
              <div className="min-w-0">
                <p className="truncate text-[15px] font-extrabold">{header.title}</p>
                {header.subtitle && <p className="truncate text-xs text-muted">{header.subtitle}</p>}
              </div>
            </div>
          )}
          {items}
        </div>
      </div>
    )

  return (
    <div
      ref={ref}
      role="menu"
      style={pos}
      className="fixed z-40 max-h-[calc(100vh-16px)] min-w-56 overflow-y-auto rounded-md bg-surface p-2 lift"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items}
    </div>
  )
}
