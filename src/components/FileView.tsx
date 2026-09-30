import { AlertTriangle, MoreVertical } from 'lucide-react'
import type { Item } from '../drive/tree'
import { fileIcon, formatBytes, formatDate } from '../lib/format'
import type { Sort, ViewMode } from '../store/useDrive'

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
  onOpen: (item: Item) => void
  onMenu: (item: Item, x: number, y: number) => void
}

export default function FileView({ items, view, onOpen, onMenu }: Props) {
  const menuFromEvent = (item: Item) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onMenu(item, e.clientX, e.clientY)
  }
  const menuFromButton = (item: Item) => (e: React.MouseEvent) => {
    e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    onMenu(item, r.left, r.bottom + 4)
  }

  if (view === 'list')
    return (
      <div className="card overflow-hidden">
        <div className="hidden grid-cols-[1fr_7rem_6rem_2.5rem] gap-4 border-b border-slate-200 px-4 py-2 text-xs font-medium text-slate-500 sm:grid dark:border-slate-800">
          <span>Name</span>
          <span>Modified</span>
          <span className="text-right">Size</span>
          <span />
        </div>
        {items.map((item) => {
          const { Icon, color } = fileIcon(item)
          return (
            <div
              key={item.id}
              onClick={() => onOpen(item)}
              onContextMenu={menuFromEvent(item)}
              className="grid cursor-pointer grid-cols-[1fr_2.5rem] items-center gap-4 border-b border-slate-100 px-4 py-2 last:border-0 hover:bg-slate-50 sm:grid-cols-[1fr_7rem_6rem_2.5rem] dark:border-slate-800/60 dark:hover:bg-slate-800/40"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Icon className={`h-5 w-5 shrink-0 ${color}`} />
                <div className="min-w-0">
                  <p className="truncate text-sm">{item.name}</p>
                  <p className="text-xs text-slate-500 sm:hidden">
                    {formatDate(item.ts)}
                    {item.kind === 'file' && ` · ${formatBytes(item.size)}`}
                  </p>
                </div>
                <Incomplete item={item} />
              </div>
              <span className="hidden text-sm text-slate-500 sm:block">{formatDate(item.ts)}</span>
              <span className="hidden text-right text-sm text-slate-500 sm:block">
                {item.kind === 'file' ? formatBytes(item.size) : '—'}
              </span>
              <button className="icon-btn" onClick={menuFromButton(item)} aria-label="More actions">
                <MoreVertical className="h-4 w-4" />
              </button>
            </div>
          )
        })}
      </div>
    )

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {items.map((item) => {
        const { Icon, color } = fileIcon(item)
        return (
          <div
            key={item.id}
            onClick={() => onOpen(item)}
            onContextMenu={menuFromEvent(item)}
            className="group card relative cursor-pointer p-3 transition hover:border-brand/50 hover:shadow-md"
          >
            <div className="flex aspect-[4/3] items-center justify-center rounded-lg bg-slate-50 dark:bg-slate-800/50">
              <Icon className={`h-12 w-12 ${color}`} strokeWidth={1.25} />
            </div>
            <div className="mt-2 flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={item.name}>
                  {item.name}
                </p>
                <p className="text-xs text-slate-500">
                  {item.kind === 'file' ? formatBytes(item.size) : formatDate(item.ts)}
                </p>
              </div>
              <Incomplete item={item} />
              <button className="icon-btn -mr-1 h-8 w-8" onClick={menuFromButton(item)} aria-label="More actions">
                <MoreVertical className="h-4 w-4" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Incomplete({ item }: { item: Item }) {
  if (item.kind !== 'file' || item.complete) return null
  return (
    <span title="Some parts of this file are missing">
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
    </span>
  )
}
