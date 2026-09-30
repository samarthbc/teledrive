import type { LucideIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuEntry {
  label: string
  icon: LucideIcon
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

/** Popup menu at screen coordinates (right-click, long-press, or a "more" button). */
export default function Menu(props: { x: number; y: number; entries: MenuEntry[]; onClose: () => void }) {
  const { x, y, entries, onClose } = props
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // Keep the menu inside the viewport
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, y + height > window.innerHeight - 8 ? y - height : y),
    })
  }, [x, y])

  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e.type === 'mousedown' && ref.current?.contains(e.target as Node)) return
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

  return (
    <div
      ref={ref}
      role="menu"
      style={pos}
      className="card fixed z-40 min-w-44 overflow-hidden rounded-xl py-1 shadow-xl"
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((e) => (
        <button
          key={e.label}
          role="menuitem"
          disabled={e.disabled}
          onClick={() => {
            onClose()
            e.onClick()
          }}
          className={`flex w-full items-center gap-3 px-3.5 py-2 text-left text-sm hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800 ${
            e.danger ? 'text-red-600' : ''
          }`}
        >
          <e.icon className="h-4 w-4" />
          {e.label}
        </button>
      ))}
    </div>
  )
}
