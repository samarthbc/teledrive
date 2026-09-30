import {
  ArchiveRestore, ArrowDownAZ, ArrowUpAZ, ChevronRight, Clock, CloudUpload, Download, Eye, FolderInput, FolderOpen,
  FolderPlus, Info, LayoutGrid, List, Menu as MenuIcon, Pencil, Plus, RefreshCw, Search, Star, StarOff, Trash2,
  TriangleAlert, X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import ConfirmDialog from '../components/dialogs/ConfirmDialog'
import DetailsDialog from '../components/dialogs/DetailsDialog'
import MoveDialog from '../components/dialogs/MoveDialog'
import PromptDialog from '../components/dialogs/PromptDialog'
import FileView, { sortItems } from '../components/FileView'
import Menu, { type MenuEntry } from '../components/Menu'
import Preview from '../components/Preview'
import Sidebar from '../components/Sidebar'
import Toasts from '../components/Toasts'
import TransferPanel from '../components/TransferPanel'
import { downloadFile, pickSaveTargets } from '../drive/download'
import { ROOT } from '../drive/meta'
import { createFolder, emptyTrash, move, remove, rename, restore, setStarred, trash, TRASH_DAYS } from '../drive/ops'
import { enqueue } from '../drive/queue'
import {
  breadcrumbs, collectTree, listFolder, locationOf, recentFiles, searchItems, starredItems, trashedItems, uniqueName,
  type FileItem, type Item,
} from '../drive/tree'
import { discard, findResumable, uploadFile } from '../drive/upload'
import { FILTERS, formatDate, type FilterKey } from '../lib/format'
import { useDrive, type SortKey } from '../store/useDrive'
import { toast, toastError } from '../store/useToast'

export type Mode = 'folder' | 'search' | 'recent' | 'starred' | 'trash'

type Modal =
  | { type: 'newFolder' }
  | { type: 'rename'; item: Item }
  | { type: 'move'; items: Item[] }
  | { type: 'deleteForever'; items: Item[] }
  | { type: 'emptyTrash' }
  | { type: 'details'; item: Item }
  | { type: 'logout' }

const SORT_LABELS: Record<SortKey, string> = { name: 'Name', date: 'Date', size: 'Size', type: 'Type' }
const TITLES: Record<Mode, string> = { folder: 'My Drive', search: 'Search', recent: 'Recent', starred: 'Starred', trash: 'Trash' }

const act = (p: Promise<unknown>) => p.catch(toastError)

export default function DrivePage({ mode }: { mode: Mode }) {
  const { folderId = ROOT } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { drive, view, sort, syncing, syncError, setView, setSort, refresh, logout } = useDrive()

  const [modal, setModal] = useState<Modal | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null)
  const [preview, setPreview] = useState<{ files: FileItem[]; index: number } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [drawer, setDrawer] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)

  const query = params.get('q') ?? ''
  // The input keeps its own text; the URL follows it (reading back from the URL drops fast keystrokes)
  const [searchText, setSearchText] = useState(mode === 'search' ? query : '')
  const filter = (params.get('type') as FilterKey | null) ?? null
  const folderExists = folderId === ROOT || drive.items.get(folderId)?.kind === 'folder'
  const current = mode === 'folder' && folderExists ? folderId : ROOT
  const crumbs = mode === 'folder' ? breadcrumbs(drive, current) : []

  const items = useMemo(() => {
    const match = filter && FILTERS[filter] ? FILTERS[filter].match : undefined
    switch (mode) {
      case 'folder':
        return sortItems(listFolder(drive, current), sort)
      case 'search':
        return sortItems(query || match ? searchItems(drive, query, match) : [], sort)
      case 'recent':
        return recentFiles(drive)
      case 'starred':
        return sortItems(starredItems(drive), sort)
      case 'trash':
        return [...trashedItems(drive)].sort((a, b) => (b.x.tr ?? 0) - (a.x.tr ?? 0))
    }
  }, [drive, mode, current, query, filter, sort])

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const selection = [...selected].flatMap((id) => byId.get(id) ?? [])

  // Selection belongs to the page being viewed
  useEffect(() => {
    setSelected(new Set())
    setAnchor(null)
  }, [location.pathname, location.search])

  useEffect(() => {
    if (mode === 'search') searchInput.current?.focus()
    else setSearchText('')
  }, [mode])

  const openFolder = (id: string) => navigate(id === ROOT ? '/' : `/folder/${id}`)
  const closeMenu = useCallback(() => setMenu(null), [])
  const clearSelection = () => setSelected(new Set())

  // ---- Actions ----

  const upload = async (files: FileList | File[]) => {
    const target = mode === 'folder' ? current : ROOT
    const drv = useDrive.getState().drive
    const taken = new Set<string>()
    for (const file of Array.from(files)) {
      const resumable = await findResumable(file, target)
      let name = resumable?.name ?? uniqueName(drv, target, file.name)
      // Avoid clashes between files in the same batch
      for (let n = 1; !resumable && taken.has(name.toLowerCase()); n++) {
        const dot = file.name.lastIndexOf('.')
        name = dot > 0 ? `${file.name.slice(0, dot)} (${n})${file.name.slice(dot)}` : `${file.name} (${n})`
      }
      taken.add(name.toLowerCase())
      if (resumable) toast(`Resuming upload of “${name}”`)
      enqueue('upload', name, file.size, (ctl) => uploadFile(file, name, target, ctl), async () => {
        const state = await findResumable(file, target)
        if (state) await discard(state)
      })
    }
    if (target !== current || mode !== 'folder') toast('Uploading to My Drive')
  }

  const download = async (list: Item[]) => {
    const files = list.filter((i): i is FileItem => i.kind === 'file' && i.complete)
    if (!files.length) return toastError(new Error('Select files to download (folders are not supported yet)'))
    if (files.length < list.length) toast('Folders and incomplete files were skipped')
    // Must run first, while the click still counts as a user gesture
    const targets = await pickSaveTargets(files)
    if (!targets) return
    for (const f of files) enqueue('download', f.name, f.size, (ctl) => downloadFile(f, targets.get(f.id)!, ctl))
  }

  const moveToTrash = async (list: Item[]) => {
    await trash(list)
    clearSelection()
    const what = list.length === 1 ? `“${list[0].name}”` : `${list.length} items`
    toast(`Moved ${what} to trash`, { label: 'Undo', onClick: () => void act(restore(useDrive.getState().drive, list)) })
  }

  const restoreItems = async (list: Item[]) => {
    await restore(useDrive.getState().drive, list)
    clearSelection()
    toast(list.length === 1 ? `Restored “${list[0].name}”` : `Restored ${list.length} items`)
  }

  const toggleStar = async (list: Item[]) => {
    const star = !list.every((i) => i.x.fav)
    await setStarred(list, star)
    toast(star ? 'Added to Starred' : 'Removed from Starred')
  }

  const open = (item: Item) => {
    if (mode === 'trash') return setModal({ type: 'details', item })
    if (item.kind === 'folder') return openFolder(item.id)
    const files = items.filter((i): i is FileItem => i.kind === 'file')
    setPreview({ files, index: files.findIndex((f) => f.id === item.id) })
  }

  // ---- Selection ----

  const toggle = (item: Item) => {
    const next = new Set(selected)
    if (next.has(item.id)) next.delete(item.id)
    else next.add(item.id)
    setSelected(next)
    setAnchor(item.id)
  }

  const onItemClick = (item: Item, e: React.MouseEvent) => {
    if (e.shiftKey && anchor) {
      const a = items.findIndex((i) => i.id === anchor)
      const b = items.findIndex((i) => i.id === item.id)
      if (a >= 0 && b >= 0) {
        const [from, to] = a < b ? [a, b] : [b, a]
        setSelected(new Set([...selected, ...items.slice(from, to + 1).map((i) => i.id)]))
        return
      }
    }
    if (e.ctrlKey || e.metaKey || selected.size) return toggle(item)
    open(item)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (modal || preview || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault()
        setSelected(new Set(items.map((i) => i.id)))
      } else if (e.key === 'Escape') clearSelection()
      else if (e.key === 'Delete' && selection.length) {
        if (mode === 'trash') setModal({ type: 'deleteForever', items: selection })
        else void act(moveToTrash(selection))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ---- Menus ----

  const itemMenu = (item: Item): MenuEntry[] => {
    if (mode === 'trash')
      return [
        { label: 'Restore', icon: ArchiveRestore, onClick: () => void act(restoreItems([item])) },
        { label: 'Details', icon: Info, onClick: () => setModal({ type: 'details', item }) },
        { label: 'Delete forever', icon: Trash2, danger: true, onClick: () => setModal({ type: 'deleteForever', items: [item] }) },
      ]
    return [
      item.kind === 'file'
        ? { label: 'Preview', icon: Eye, onClick: () => open(item) }
        : { label: 'Open', icon: FolderOpen, onClick: () => openFolder(item.id) },
      ...(item.kind === 'file'
        ? [{ label: 'Download', icon: Download, onClick: () => void download([item]), disabled: !item.complete }]
        : []),
      ...(mode !== 'folder' ? [{ label: 'Show in folder', icon: FolderInput, onClick: () => openFolder(item.parent) }] : []),
      { label: 'Rename', icon: Pencil, onClick: () => setModal({ type: 'rename', item }) },
      { label: 'Move', icon: FolderInput, onClick: () => setModal({ type: 'move', items: [item] }) },
      item.x.fav
        ? { label: 'Remove from Starred', icon: StarOff, onClick: () => void act(toggleStar([item])) }
        : { label: 'Add to Starred', icon: Star, onClick: () => void act(toggleStar([item])) },
      { label: 'Details', icon: Info, onClick: () => setModal({ type: 'details', item }) },
      { label: 'Move to trash', icon: Trash2, danger: true, onClick: () => void act(moveToTrash([item])) },
    ]
  }

  const sortMenu = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    setMenu({
      x: r.left,
      y: r.bottom + 4,
      entries: [
        ...(Object.keys(SORT_LABELS) as SortKey[]).map((key) => ({
          label: `${SORT_LABELS[key]}${sort.key === key ? ' ✓' : ''}`,
          icon: sort.dir === 'asc' ? ArrowDownAZ : ArrowUpAZ,
          onClick: () => setSort({ key, dir: sort.dir }),
        })),
        {
          label: sort.dir === 'asc' ? 'Descending' : 'Ascending',
          icon: sort.dir === 'asc' ? ArrowUpAZ : ArrowDownAZ,
          onClick: () => setSort({ key: sort.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }),
        },
      ],
    })
  }

  // ---- Search and filters ----

  const setSearch = (q: string, type = filter) => {
    const next = new URLSearchParams()
    if (q) next.set('q', q)
    if (type) next.set('type', type)
    if (mode === 'search') setParams(next, { replace: true })
    else navigate(`/search?${next}`)
  }

  // Filters always search the whole drive (a folder view filtered to nothing is confusing)
  const setFilter = (type: FilterKey | null) => setSearch(query, type)

  // ---- Drag and drop ----

  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files')
  const dropHandlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (!hasFiles(e)) return
      dragDepth.current++
      setDragging(true)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!hasFiles(e)) return
      if (--dragDepth.current <= 0) setDragging(false)
    },
    onDragOver: (e: React.DragEvent) => hasFiles(e) && e.preventDefault(),
    onDrop: (e: React.DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      // Dropped folders show up as empty entries without a type; skip them
      const files = Array.from(e.dataTransfer.files).filter((f) => f.size > 0 || f.type)
      if (files.length) void upload(files)
      else toast('Folder upload is coming in a later version')
    },
  }

  const sidebar = (
    <Sidebar
      onUpload={() => fileInput.current?.click()}
      onNewFolder={() => setModal({ type: 'newFolder' })}
      onLogout={() => setModal({ type: 'logout' })}
    />
  )

  const subtitle =
    mode === 'folder'
      ? undefined
      : mode === 'trash'
        ? (i: Item) => `Deleted ${formatDate(i.x.tr ?? 0)} · from ${locationOf(drive, i)}`
        : (i: Item) => locationOf(drive, i)

  return (
    <div className="flex h-full" {...dropHandlers}>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void upload(Array.from(e.target.files))
          e.target.value = ''
        }}
      />

      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white md:block dark:border-slate-800 dark:bg-slate-900">
        {sidebar}
      </aside>
      {drawer && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setDrawer(false)}>
          <aside className="h-full w-72 bg-white dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div onClickCapture={() => setDrawer(false)} className="h-full">
              {sidebar}
            </div>
          </aside>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-14 flex-wrap items-center gap-2 border-b border-slate-200 bg-white/80 px-3 py-2 backdrop-blur sm:px-5 dark:border-slate-800 dark:bg-slate-900/80">
          {selection.length ? (
            <SelectionBar
              count={selection.length}
              trashMode={mode === 'trash'}
              allStarred={selection.every((i) => i.x.fav)}
              onClear={clearSelection}
              onDownload={() => void download(selection)}
              onMove={() => setModal({ type: 'move', items: selection })}
              onStar={() => void act(toggleStar(selection))}
              onTrash={() => void act(moveToTrash(selection))}
              onRestore={() => void act(restoreItems(selection))}
              onDeleteForever={() => setModal({ type: 'deleteForever', items: selection })}
            />
          ) : (
            <>
              <button className="icon-btn md:hidden" onClick={() => setDrawer(true)} aria-label="Menu">
                <MenuIcon className="h-5 w-5" />
              </button>
              <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-sm whitespace-nowrap">
                {mode === 'folder' ? (
                  <>
                    <button className="rounded-md px-2 py-1 font-medium hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => openFolder(ROOT)}>
                      My Drive
                    </button>
                    {crumbs.map((f) => (
                      <span key={f.id} className="flex items-center gap-1">
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                        <button className="rounded-md px-2 py-1 font-medium hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => openFolder(f.id)}>
                          {f.name}
                        </button>
                      </span>
                    ))}
                  </>
                ) : (
                  <h1 className="px-2 text-base font-semibold">{TITLES[mode]}</h1>
                )}
              </nav>
              <div className="relative order-last w-full sm:order-none sm:w-64 lg:w-80">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  ref={searchInput}
                  type="text"
                  role="searchbox"
                  enterKeyHint="search"
                  placeholder="Search your drive"
                  className="input py-2 pr-9 pl-9"
                  value={searchText}
                  onChange={(e) => {
                    setSearchText(e.target.value)
                    setSearch(e.target.value.trim())
                  }}
                  onKeyDown={(e) => e.key === 'Escape' && navigate('/')}
                />
                {mode === 'search' && (searchText || filter) && (
                  <button
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600"
                    onClick={() => navigate('/')}
                    aria-label="Clear search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {syncError && (
                <span title={syncError}>
                  <TriangleAlert className="h-5 w-5 text-amber-500" />
                </span>
              )}
              <button className="icon-btn" onClick={() => void refresh()} aria-label="Refresh" title="Refresh">
                <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
              </button>
              {mode !== 'recent' && mode !== 'trash' && (
                <button className="icon-btn" onClick={sortMenu} aria-label="Sort" title={`Sort by ${SORT_LABELS[sort.key]}`}>
                  {sort.dir === 'asc' ? <ArrowDownAZ className="h-4 w-4" /> : <ArrowUpAZ className="h-4 w-4" />}
                </button>
              )}
              <button
                className="icon-btn"
                onClick={() => setView(view === 'grid' ? 'list' : 'grid')}
                aria-label={view === 'grid' ? 'List view' : 'Grid view'}
                title={view === 'grid' ? 'List view' : 'Grid view'}
              >
                {view === 'grid' ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
              </button>
            </>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-3 pb-28 sm:p-5" onClick={(e) => e.target === e.currentTarget && clearSelection()}>
          {(mode === 'folder' || mode === 'search') && (
            <div className="-mx-3 mb-4 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
              <button className={mode === 'search' && filter ? 'chip' : 'chip-active'} onClick={() => setFilter(null)}>
                All
              </button>
              {(Object.keys(FILTERS) as FilterKey[]).map((key) => (
                <button key={key} className={mode === 'search' && filter === key ? 'chip-active' : 'chip'} onClick={() => setFilter(filter === key ? null : key)}>
                  {FILTERS[key].label}
                </button>
              ))}
            </div>
          )}
          {mode === 'trash' && items.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-100 px-4 py-2.5 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-400">
              <span>Items in the trash are deleted forever after {TRASH_DAYS} days.</span>
              <button className="btn-ghost py-1 text-red-600 dark:text-red-400" onClick={() => setModal({ type: 'emptyTrash' })}>
                Empty trash
              </button>
            </div>
          )}
          {mode === 'search' && (query || filter) && (
            <p className="mb-3 text-sm text-slate-500">
              {items.length === 500 ? 'Showing the first 500 results' : `${items.length} result${items.length === 1 ? '' : 's'}`}
            </p>
          )}

          {items.length ? (
            <FileView
              items={items}
              view={view}
              selected={selected}
              onClick={onItemClick}
              onToggle={toggle}
              onMenu={(item, x, y) => setMenu({ x, y, entries: itemMenu(item) })}
              subtitle={subtitle}
            />
          ) : (
            <EmptyState
              mode={mode}
              filtered={!!filter}
              searched={!!query}
              isRoot={current === ROOT}
              onUpload={() => fileInput.current?.click()}
              onNewFolder={() => setModal({ type: 'newFolder' })}
            />
          )}
        </div>
      </main>

      {/* Mobile upload button */}
      {!selection.length && (
        <button
          className="fixed right-5 bottom-5 z-20 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white shadow-lg shadow-brand/40 md:hidden"
          onClick={() => fileInput.current?.click()}
          aria-label="Upload"
        >
          <Plus className="h-6 w-6" />
        </button>
      )}

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-brand/10 p-6 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-brand bg-white/90 px-12 py-10 dark:bg-slate-900/90">
            <CloudUpload className="h-12 w-12 text-brand" />
            <p className="font-medium">Drop to upload to {mode === 'folder' ? (crumbs.at(-1)?.name ?? 'My Drive') : 'My Drive'}</p>
          </div>
        </div>
      )}

      {preview && (
        <Preview
          files={preview.files}
          index={preview.index}
          onIndex={(index) => setPreview({ ...preview, index })}
          onClose={() => setPreview(null)}
          onDownload={(f) => void download([f])}
          onDetails={(item) => setModal({ type: 'details', item })}
        />
      )}
      {menu && <Menu {...menu} onClose={closeMenu} />}
      <TransferPanel />
      <Toasts />

      {modal?.type === 'newFolder' && (
        <PromptDialog
          title="New folder"
          initial="Untitled folder"
          confirmLabel="Create"
          onSubmit={async (name) => void (await createFolder(useDrive.getState().drive, mode === 'folder' ? current : ROOT, name))}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'rename' && (
        <PromptDialog
          title="Rename"
          initial={modal.item.name}
          confirmLabel="Rename"
          onSubmit={(name) => rename(useDrive.getState().drive, modal.item, name)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'move' && (
        <MoveDialog
          drive={drive}
          items={modal.items}
          onMove={async (target) => {
            await move(useDrive.getState().drive, modal.items, target)
            clearSelection()
            toast(`Moved ${modal.items.length === 1 ? `“${modal.items[0].name}”` : `${modal.items.length} items`}`)
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'deleteForever' && (
        <ConfirmDialog
          title="Delete forever?"
          danger
          confirmLabel="Delete forever"
          message={<DeleteMessage items={modal.items} />}
          onConfirm={async () => {
            await remove(useDrive.getState().drive, modal.items)
            clearSelection()
            toast('Deleted forever')
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'emptyTrash' && (
        <ConfirmDialog
          title="Empty trash?"
          danger
          confirmLabel="Empty trash"
          message="Everything in the trash will be deleted from Telegram. This can't be undone."
          onConfirm={async () => {
            const n = await emptyTrash(useDrive.getState().drive)
            toast(`Deleted ${n} item${n === 1 ? '' : 's'} forever`)
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'details' && (
        <DetailsDialog
          drive={drive}
          item={modal.item}
          onDownload={() => {
            void download([modal.item])
            setModal(null)
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'logout' && (
        <ConfirmDialog
          title="Log out?"
          confirmLabel="Log out"
          message="Your files stay safe in Telegram. You can log in again any time."
          onConfirm={logout}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

function SelectionBar(props: {
  count: number
  trashMode: boolean
  allStarred: boolean
  onClear: () => void
  onDownload: () => void
  onMove: () => void
  onStar: () => void
  onTrash: () => void
  onRestore: () => void
  onDeleteForever: () => void
}) {
  const p = props
  return (
    <>
      <button className="icon-btn" onClick={p.onClear} aria-label="Clear selection">
        <X className="h-5 w-5" />
      </button>
      <span className="flex-1 text-sm font-medium">{p.count} selected</span>
      {p.trashMode ? (
        <>
          <button className="btn-ghost" onClick={p.onRestore}>
            <ArchiveRestore className="h-4 w-4" /> <span className="hidden sm:inline">Restore</span>
          </button>
          <button className="btn-ghost text-red-600 dark:text-red-400" onClick={p.onDeleteForever}>
            <Trash2 className="h-4 w-4" /> <span className="hidden sm:inline">Delete forever</span>
          </button>
        </>
      ) : (
        <>
          <button className="icon-btn" onClick={p.onDownload} aria-label="Download" title="Download">
            <Download className="h-4 w-4" />
          </button>
          <button className="icon-btn" onClick={p.onMove} aria-label="Move" title="Move">
            <FolderInput className="h-4 w-4" />
          </button>
          <button className="icon-btn" onClick={p.onStar} aria-label={p.allStarred ? 'Unstar' : 'Star'} title={p.allStarred ? 'Remove from Starred' : 'Add to Starred'}>
            {p.allStarred ? <StarOff className="h-4 w-4" /> : <Star className="h-4 w-4" />}
          </button>
          <button className="icon-btn text-red-600 dark:text-red-400" onClick={p.onTrash} aria-label="Move to trash" title="Move to trash">
            <Trash2 className="h-4 w-4" />
          </button>
        </>
      )}
    </>
  )
}

function EmptyState(props: {
  mode: Mode
  filtered: boolean
  searched: boolean
  isRoot: boolean
  onUpload: () => void
  onNewFolder: () => void
}) {
  const { mode, filtered, searched, isRoot, onUpload, onNewFolder } = props
  const content: Record<Mode, { icon: typeof Search; title: string; text: string }> = {
    folder: { icon: CloudUpload, title: isRoot ? 'Your drive is empty' : 'This folder is empty', text: 'Drop files here or use the Upload button' },
    search: searched || filtered
      ? { icon: Search, title: 'No results', text: 'Try a different name or filter.' }
      : { icon: Search, title: 'Search your drive', text: 'Type a file or folder name, or pick a filter.' },
    recent: { icon: Clock, title: 'No recent files', text: 'Files you upload will show up here.' },
    starred: { icon: Star, title: 'Nothing starred yet', text: 'Star files and folders to find them quickly.' },
    trash: { icon: Trash2, title: 'Trash is empty', text: `Deleted items stay here for ${TRASH_DAYS} days.` },
  }
  const { icon: Icon, title, text } = content[mode]
  return (
    <div className="flex h-full min-h-72 flex-col items-center justify-center gap-3 text-center text-slate-500">
      <Icon className="h-14 w-14 text-slate-300 dark:text-slate-700" strokeWidth={1.25} />
      <p className="font-medium text-slate-700 dark:text-slate-300">{title}</p>
      <p className="text-sm">{text}</p>
      {mode === 'folder' && (
        <div className="mt-2 flex gap-2">
          <button className="btn-primary" onClick={onUpload}>
            Upload files
          </button>
          <button className="btn-ghost" onClick={onNewFolder}>
            <FolderPlus className="h-4 w-4" /> New folder
          </button>
        </div>
      )}
    </div>
  )
}

function DeleteMessage({ items }: { items: Item[] }) {
  const drive = useDrive((s) => s.drive)
  const inside = items.reduce((n, i) => n + collectTree(drive, i.id).length - 1, 0)
  const what = items.length === 1 ? `“${items[0].name}”` : `${items.length} items`
  return (
    <p>
      {what}
      {inside > 0 && ` and ${inside} item${inside > 1 ? 's' : ''} inside`} will be deleted from Telegram. This can't be undone.
    </p>
  )
}
