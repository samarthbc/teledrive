import { AlertTriangle, Check, Lock, LockOpen, MoreVertical, Star } from 'lucide-react'
import { useRef } from 'react'
import type { Item } from '../drive/tree'
import { formatBytes, formatDate } from '../lib/format'
import { useSettings } from '../lib/settings'
import type { Sort, ViewMode } from '../store/useDrive'
import Thumb from './Thumb'

export function sortItems(items: Item[], sort: Sort): Item[] {
  const dir = sort.dir === 'asc' ? 1 : -1
  const ext = (i: Item) => (i.kind === 'file' ? (i.name.split('.').pop() ?? '') : '')
  const cmp = (a: Item, b: Item): number => {
    switch (sort.key) {
      case 'date':
        return a.ts - b.ts
      case 'size':
        return (a.kind === 'file' ? a.size : 0) - (b.kind === 'file' ? b.size : 0)
      case 'type':
        return ext(a).localeCompare(ext(b)) || a.name.localeCompare(b.name)
      default:
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    }
  }
  // Folders always come first
  return [...items].sort((a, b) => (a.kind === b.kind ? cmp(a, b) * dir : a.kind === 'folder' ? -1 : 1))
}

interface Props {
  items: Item[]
  view: ViewMode
  selected: Set<string>
  /** Plain click, Ctrl/Cmd-click or Shift-click on an item. */
  onClick: (item: Item, e: React.MouseEvent) => void
  onToggle: (item: Item) => void
  onMenu: (item: Item, x: number, y: number) => void
  /** Extra line under the name, e.g. the item's folder in search results. */
  subtitle?: (item: Item) => string | undefined
}

export default function FileView({ items, view, selected, onClick, onToggle, onMenu, subtitle }: Props) {
  const pointer = useRef<string>('mouse')
  const selecting = selected.size > 0
  // Settings → Density: compact fits more on screen (shorter rows, smaller cards)
  const compact = useSettings((s) => s.density === 'compact')

  const handlers = (item: Item) => ({
    onPointerDown: (e: React.PointerEvent) => (pointer.current = e.pointerType),
    onClick: (e: React.MouseEvent) => onClick(item, e),
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      // Long-press on touch screens selects, like in phone gallery apps
      if (pointer.current === 'touch') onToggle(item)
      else onMenu(item, e.clientX, e.clientY)
    },
  })
  const moreButton = (item: Item, className = '') => (
    <button
      className={`icon-btn-flat ${className}`}
      aria-label="More actions"
      onClick={(e) => {
        e.stopPropagation()
        const r = e.currentTarget.getBoundingClientRect()
        onMenu(item, r.left, r.bottom + 4)
      }}
    >
      <MoreVertical />
    </button>
  )
  const checkbox = (item: Item, className = '') => (
    <button
      role="checkbox"
      aria-checked={selected.has(item.id)}
      aria-label={`Select ${item.name}`}
      onClick={(e) => {
        e.stopPropagation()
        onToggle(item)
      }}
      className={`size-6 shrink-0 items-center justify-center rounded-[5px] transition ${
        selected.has(item.id) ? 'bg-brand text-white raised-xs' : 'bg-surface text-transparent pressed-xs'
      } ${className}`}
    >
      <Check className="size-4" strokeWidth={3} />
    </button>
  )

  if (view === 'list')
    return (
      <div className={`panel flex flex-col select-none ${compact ? 'gap-0.5 p-1 sm:p-1.5' : 'gap-1 p-1.5 sm:p-2'}`}>
        {items.map((item) => {
          const sub = subtitle?.(item)
          const isSel = selected.has(item.id)
          return (
            <div
              key={item.id}
              {...handlers(item)}
              className={`group flex cursor-pointer items-center gap-3 rounded-md px-2 sm:gap-3.5 sm:px-3 ${compact ? 'py-1' : 'py-2 sm:py-2.5'} ${
                isSel ? 'pressed' : 'hover:bg-ink/[0.03]'
              }`}
            >
              {/* The checkbox takes the icon's place on hover and while selecting */}
              <div className={`relative shrink-0 overflow-hidden rounded-md bg-surface raised-sm ${compact ? 'size-8.5' : 'size-11'}`}>
                <Thumb item={item} iconClass={compact ? 'size-4.5' : 'size-5.5'} />
                {checkbox(item, `absolute inset-0 m-auto ${selecting || isSel ? 'flex' : 'hidden group-hover:flex focus-visible:flex'}`)}
              </div>
              <div className="min-w-0 flex-1">
                <p className={`flex items-center gap-2 font-bold ${compact ? 'text-sm' : 'text-[15px]'}`}>
                  <span className="truncate">{item.name}</span>
                  <Badges item={item} />
                </p>
                <p className={`truncate text-muted ${compact ? 'text-xs' : 'mt-0.5 text-[13px]'}`}>
                  {sub ?? details(item)}
                  <span className="sm:hidden"> · {formatDate(item.ts)}</span>
                </p>
              </div>
              <span className="hidden shrink-0 text-xs text-muted sm:block">{formatDate(item.ts)}</span>
              {moreButton(item)}
            </div>
          )
        })}
      </div>
    )

  return (
    <div
      className={`grid select-none ${
        compact
          ? 'grid-cols-3 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] sm:gap-3'
          : 'grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] sm:gap-4.5'
      }`}
    >
      {items.map((item) => {
        const sub = subtitle?.(item)
        const isSel = selected.has(item.id)
        return (
          <div
            key={item.id}
            {...handlers(item)}
            className={`group card relative cursor-pointer ${compact ? 'p-1.5' : 'p-2'} ${isSel ? 'outline-2 outline-offset-3 outline-brand' : ''}`}
          >
            <div className="aspect-[4/3] overflow-hidden rounded-md pressed">
              <Thumb item={item} iconClass={compact ? 'size-6.5' : 'size-8.5'} />
            </div>
            {checkbox(item, `absolute ${compact ? 'top-2.5 left-2.5' : 'top-3.5 left-3.5'} flex ${selecting || isSel ? '' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}`)}
            {/* Compact: the menu sits on the thumbnail's corner, so the name gets the card's full width */}
            {compact && moreButton(item, 'absolute top-1.5 right-1.5 size-8')}
            <div className={`flex items-center gap-1 ${compact ? 'mt-1 px-0.5' : 'mt-2 pl-1'}`}>
              <div className="min-w-0 flex-1">
                <p className={`flex items-center gap-1.5 font-bold ${compact ? 'text-[13px]' : 'text-sm'}`} title={item.name}>
                  <span className="truncate">{item.name}</span>
                  <Badges item={item} short />
                </p>
                <p className="truncate text-xs text-muted">{sub ?? details(item)}</p>
              </div>
              {!compact && moreButton(item, '-mr-1')}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Size for files; for locked items, why there's nothing to show. */
function details(item: Item): string {
  if (item.lock && item.locked) return item.kind === 'folder' ? 'Protected with its own password' : 'Locked'
  return item.kind === 'file' ? formatBytes(item.size) : 'Folder'
}

function Badges({ item, short }: { item: Item; short?: boolean }) {
  const size = short ? 'size-3.5' : 'size-4'
  return (
    <>
      {item.x.fav && <Star className="size-3.5 shrink-0 text-brand-ink" strokeWidth={2.2} aria-label="Starred" />}
      {/* Locked: a closed lock; unlocked for now: an open one (locks again after the auto-lock time) */}
      {item.lock && (
        <span
          title={item.locked ? 'Locked: needs its password' : 'Unlocked for now (locks again after a few idle minutes)'}
          aria-label={item.locked ? 'Locked' : 'Unlocked'}
          className="shrink-0 text-brand-ink"
        >
          {item.locked ? <Lock className={size} strokeWidth={2.2} /> : <LockOpen className={size} strokeWidth={2.2} />}
        </span>
      )}
      {item.kind === 'file' && !item.complete && (
        <span title="Some parts of this file are missing" className="shrink-0 text-brand-ink">
          <AlertTriangle className="size-3.5" strokeWidth={2.2} />
        </span>
      )}
    </>
  )
}
