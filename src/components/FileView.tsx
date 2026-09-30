import { AlertTriangle, Check, MoreVertical, Star } from 'lucide-react'
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
  const moreButton = (item: Item, className: string) => (
    <button
      className={`icon-btn ${className}`}
      aria-label="More actions"
      onClick={(e) => {
        e.stopPropagation()
        const r = e.currentTarget.getBoundingClientRect()
        onMenu(item, r.left, r.bottom + 4)
      }}
    >
      <MoreVertical className="h-4 w-4" />
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
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition ${
        selected.has(item.id)
          ? 'border-brand bg-brand text-white'
          : 'border-slate-300 bg-white/90 text-transparent dark:border-slate-600 dark:bg-slate-900/90'
      } ${className}`}
    >
      <Check className="h-3.5 w-3.5" strokeWidth={3} />
    </button>
  )

  if (view === 'list')
    return (
      <div className="card overflow-hidden select-none">
        <div className="hidden grid-cols-[1.25rem_1fr_7rem_6rem_2.25rem] items-center gap-4 border-b border-slate-200 px-4 py-2 text-xs font-medium text-slate-500 sm:grid dark:border-slate-800">
          <span />
          <span>Name</span>
          <span>Modified</span>
          <span className="text-right">Size</span>
          <span />
        </div>
        {items.map((item) => {
          const sub = subtitle?.(item)
          const isSel = selected.has(item.id)
          return (
            <div
              key={item.id}
              {...handlers(item)}
              className={`group grid cursor-pointer grid-cols-[1.25rem_1fr_2.25rem] items-center gap-3 border-b border-slate-100 px-4 py-1.5 last:border-0 sm:grid-cols-[1.25rem_1fr_7rem_6rem_2.25rem] sm:gap-4 dark:border-slate-800/60 ${
                isSel ? 'bg-brand/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
              }`}
            >
              {checkbox(item, selecting || isSel ? '' : 'sm:opacity-0 sm:group-hover:opacity-100')}
              <div className="flex min-w-0 items-center gap-3">
                <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md">
                  <Thumb item={item} iconClass="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate text-sm">
                    <span className="truncate">{item.name}</span>
                    <Badges item={item} />
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {sub ?? (
                      <span className="sm:hidden">
                        {formatDate(item.ts)}
                        {item.kind === 'file' && ` · ${formatBytes(item.size)}`}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <span className="hidden text-sm text-slate-500 sm:block">{formatDate(item.ts)}</span>
              <span className="hidden text-right text-sm text-slate-500 sm:block">
                {item.kind === 'file' ? formatBytes(item.size) : '—'}
              </span>
              {moreButton(item, 'h-8 w-8')}
            </div>
          )
        })}
      </div>
    )

  return (
    <div className="grid grid-cols-2 gap-3 select-none sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {items.map((item) => {
        const sub = subtitle?.(item)
        const isSel = selected.has(item.id)
        return (
          <div
            key={item.id}
            {...handlers(item)}
            className={`group card relative cursor-pointer p-2 transition ${
              isSel ? 'border-brand ring-2 ring-brand/40' : 'hover:border-brand/50 hover:shadow-md'
            }`}
          >
            <div className="aspect-[4/3] overflow-hidden rounded-lg bg-slate-50 dark:bg-slate-800/50">
              <Thumb item={item} iconClass="h-12 w-12" />
            </div>
            {checkbox(item, `absolute top-3.5 left-3.5 ${selecting || isSel ? '' : 'opacity-0 group-hover:opacity-100'}`)}
            <div className="mt-2 flex items-center gap-1 pl-1">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 text-sm font-medium" title={item.name}>
                  <span className="truncate">{item.name}</span>
                  <Badges item={item} />
                </p>
                <p className="truncate text-xs text-slate-500">
                  {sub ?? (item.kind === 'file' ? formatBytes(item.size) : formatDate(item.ts))}
                </p>
              </div>
              {moreButton(item, '-mr-1 h-8 w-8')}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Badges({ item }: { item: Item }) {
  return (
    <>
      {item.x.fav && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" aria-label="Starred" />}
      {item.kind === 'file' && !item.complete && (
        <span title="Some parts of this file are missing">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
        </span>
      )}
    </>
  )
}
