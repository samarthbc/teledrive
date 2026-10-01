import { AlertTriangle, Check, Lock, LockOpen, MoreVertical, Star } from 'lucide-react'
import { useRef } from 'react'
import type { Item } from '../drive/tree'
import { formatBytes, formatDate } from '../lib/format'
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
      <div className="panel flex flex-col gap-1 p-1.5 select-none sm:p-2">
        {items.map((item) => {
          const sub = subtitle?.(item)
          const isSel = selected.has(item.id)
          return (
            <div
              key={item.id}
              {...handlers(item)}
              className={`group flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 sm:gap-3.5 sm:px-3 sm:py-2.5 ${
                isSel ? 'pressed' : 'hover:bg-ink/[0.03]'
              }`}
            >
              {/* The checkbox takes the icon's place on hover and while selecting */}
              <div className="relative size-11 shrink-0 overflow-hidden rounded-md bg-surface raised-sm">
                <Thumb item={item} iconClass="size-5.5" />
                {checkbox(item, `absolute inset-0 m-auto ${selecting || isSel ? 'flex' : 'hidden group-hover:flex focus-visible:flex'}`)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[15px] font-bold">
                  <span className="truncate">{item.name}</span>
                  <Badges item={item} />
                </p>
                <p className="mt-0.5 truncate text-[13px] text-muted">
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
    <div className="grid grid-cols-2 gap-3 select-none sm:grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] sm:gap-4.5">
      {items.map((item) => {
        const sub = subtitle?.(item)
        const isSel = selected.has(item.id)
        return (
          <div
            key={item.id}
            {...handlers(item)}
            className={`group card relative cursor-pointer p-2 ${isSel ? 'outline-2 outline-offset-3 outline-brand' : ''}`}
          >
            <div className="aspect-[4/3] overflow-hidden rounded-md pressed">
              <Thumb item={item} iconClass="size-8.5" />
            </div>
            {checkbox(item, `absolute top-3.5 left-3.5 flex ${selecting || isSel ? '' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}`)}
            <div className="mt-2 flex items-center gap-1 pl-1">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-bold" title={item.name}>
                  <span className="truncate">{item.name}</span>
                  <Badges item={item} short />
                </p>
                <p className="truncate text-xs text-muted">{sub ?? details(item)}</p>
              </div>
              {moreButton(item, '-mr-1')}
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

const LABEL = 'shrink-0 text-[11px] font-extrabold tracking-[0.08em] text-brand-ink'

function Badges({ item, short }: { item: Item; short?: boolean }) {
  return (
    <>
      {item.x.fav && <Star className="size-3.5 shrink-0 text-brand-ink" strokeWidth={2.2} aria-label="Starred" />}
      {item.lock &&
        (short ? (
          <span title={item.locked ? 'Locked' : 'Unlocked for now'} className="shrink-0 text-brand-ink">
            {item.locked ? <Lock className="size-3.5" strokeWidth={2.2} /> : <LockOpen className="size-3.5" strokeWidth={2.2} />}
          </span>
        ) : (
          <span
            className={LABEL}
            title={item.locked ? 'Locked: needs its password' : 'Unlocked for now (locks again after a few idle minutes)'}
          >
            {item.locked ? 'LOCKED' : 'OPEN'}
          </span>
        ))}
      {item.kind === 'file' && !item.complete && (
        <span title="Some parts of this file are missing" className="shrink-0 text-brand-ink">
          <AlertTriangle className="size-3.5" strokeWidth={2.2} />
        </span>
      )}
    </>
  )
}
