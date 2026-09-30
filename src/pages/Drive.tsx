import {
  ArrowDownAZ, ArrowUpAZ, ChevronRight, CloudUpload, Download, FolderInput, FolderPlus, Info, LayoutGrid, List,
  Menu as MenuIcon, Pencil, Plus, RefreshCw, Trash2, TriangleAlert,
} from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ConfirmDialog from '../components/dialogs/ConfirmDialog'
import DetailsDialog from '../components/dialogs/DetailsDialog'
import MoveDialog from '../components/dialogs/MoveDialog'
import PromptDialog from '../components/dialogs/PromptDialog'
import FileView, { sortItems } from '../components/FileView'
import Menu, { type MenuEntry } from '../components/Menu'
import Sidebar from '../components/Sidebar'
import Toasts from '../components/Toasts'
import TransferPanel from '../components/TransferPanel'
import { downloadFile, pickSaveTarget } from '../drive/download'
import { ROOT } from '../drive/meta'
import { createFolder, move, remove, rename } from '../drive/ops'
import { enqueue } from '../drive/queue'
import { breadcrumbs, collectTree, listFolder, uniqueName, type FileItem, type Item } from '../drive/tree'
import { uploadFile } from '../drive/upload'
import { useDrive, type SortKey } from '../store/useDrive'
import { toast, toastError } from '../store/useToast'

type Modal =
  | { type: 'newFolder' }
  | { type: 'rename'; item: Item }
  | { type: 'move'; items: Item[] }
  | { type: 'delete'; items: Item[] }
  | { type: 'details'; item: Item }
  | { type: 'logout' }

const SORT_LABELS: Record<SortKey, string> = { name: 'Name', date: 'Date', size: 'Size', type: 'Type' }

export default function DrivePage() {
  const { folderId = ROOT } = useParams()
  const navigate = useNavigate()
  const { drive, view, sort, syncing, syncError, setView, setSort, refresh, logout } = useDrive()
  const [modal, setModal] = useState<Modal | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null)
  const [drawer, setDrawer] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)

  const folderExists = folderId === ROOT || drive.items.get(folderId)?.kind === 'folder'
  const current = folderExists ? folderId : ROOT
  const items = sortItems(listFolder(drive, current), sort)
  const crumbs = breadcrumbs(drive, current)
  const open = (id: string) => navigate(id === ROOT ? '/' : `/folder/${id}`)
  const closeMenu = useCallback(() => setMenu(null), [])

  // ---- Actions ----

  const upload = (files: FileList | File[]) => {
    const drv = useDrive.getState().drive
    const taken = new Set<string>()
    for (const file of Array.from(files)) {
      let name = uniqueName(drv, current, file.name)
      // Avoid clashes between files in the same batch
      for (let n = 1; taken.has(name.toLowerCase()); n++) {
        const dot = file.name.lastIndexOf('.')
        name = dot > 0 ? `${file.name.slice(0, dot)} (${n})${file.name.slice(dot)}` : `${file.name} (${n})`
      }
      taken.add(name.toLowerCase())
      enqueue('upload', name, file.size, (ctl) => uploadFile(file, name, current, ctl))
    }
  }

  const download = async (item: FileItem) => {
    if (!item.complete) return toastError(new Error('This file is incomplete and cannot be downloaded'))
    const target = await pickSaveTarget(item) // must run first, while the click still counts as a user gesture
    if (!target) return
    enqueue('download', item.name, item.size, (ctl) => downloadFile(item, target, ctl))
  }

  const openItem = (item: Item) => (item.kind === 'folder' ? open(item.id) : setModal({ type: 'details', item }))

  const showMenu = (item: Item, x: number, y: number) =>
    setMenu({
      x,
      y,
      entries: [
        ...(item.kind === 'file'
          ? [{ label: 'Download', icon: Download, onClick: () => void download(item), disabled: !item.complete }]
          : [{ label: 'Open', icon: FolderInput, onClick: () => open(item.id) }]),
        { label: 'Rename', icon: Pencil, onClick: () => setModal({ type: 'rename', item }) },
        { label: 'Move', icon: FolderInput, onClick: () => setModal({ type: 'move', items: [item] }) },
        { label: 'Details', icon: Info, onClick: () => setModal({ type: 'details', item }) },
        { label: 'Delete', icon: Trash2, danger: true, onClick: () => setModal({ type: 'delete', items: [item] }) },
      ],
    })

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
      // Folders can't be read from a plain drop yet; skip entries with no type and size 0
      const files = Array.from(e.dataTransfer.files).filter((f) => f.size > 0 || f.type)
      if (files.length) upload(files)
      else toast('Folder upload is coming in a later version')
    },
  }

  const sidebar = (
    <Sidebar
      onUpload={() => fileInput.current?.click()}
      onNewFolder={() => setModal({ type: 'newFolder' })}
      onLogout={() => setModal({ type: 'logout' })}
      onHome={() => open(ROOT)}
    />
  )

  return (
    <div className="flex h-full" {...dropHandlers}>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) upload(e.target.files)
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
        <header className="flex items-center gap-2 border-b border-slate-200 bg-white/80 px-3 py-2 backdrop-blur sm:px-5 dark:border-slate-800 dark:bg-slate-900/80">
          <button className="icon-btn md:hidden" onClick={() => setDrawer(true)} aria-label="Menu">
            <MenuIcon className="h-5 w-5" />
          </button>
          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-sm whitespace-nowrap">
            <button className="rounded-md px-2 py-1 font-medium hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => open(ROOT)}>
              My Drive
            </button>
            {crumbs.map((f) => (
              <span key={f.id} className="flex items-center gap-1">
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                <button className="rounded-md px-2 py-1 font-medium hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => open(f.id)}>
                  {f.name}
                </button>
              </span>
            ))}
          </nav>
          {syncError && (
            <span title={syncError}>
              <TriangleAlert className="h-5 w-5 text-amber-500" />
            </span>
          )}
          <button className="icon-btn" onClick={() => void refresh()} aria-label="Refresh" title="Refresh">
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          </button>
          <button className="icon-btn" onClick={sortMenu} aria-label="Sort" title={`Sort by ${SORT_LABELS[sort.key]}`}>
            {sort.dir === 'asc' ? <ArrowDownAZ className="h-4 w-4" /> : <ArrowUpAZ className="h-4 w-4" />}
          </button>
          <button
            className="icon-btn"
            onClick={() => setView(view === 'grid' ? 'list' : 'grid')}
            aria-label={view === 'grid' ? 'List view' : 'Grid view'}
            title={view === 'grid' ? 'List view' : 'Grid view'}
          >
            {view === 'grid' ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-3 pb-28 sm:p-5">
          {items.length ? (
            <FileView items={items} view={view} onOpen={openItem} onMenu={showMenu} />
          ) : (
            <div className="flex h-full min-h-72 flex-col items-center justify-center gap-3 text-center text-slate-500">
              <CloudUpload className="h-14 w-14 text-slate-300 dark:text-slate-700" strokeWidth={1.25} />
              <p className="font-medium text-slate-700 dark:text-slate-300">
                {current === ROOT ? 'Your drive is empty' : 'This folder is empty'}
              </p>
              <p className="text-sm">Drop files here or use the Upload button</p>
              <div className="mt-2 flex gap-2">
                <button className="btn-primary" onClick={() => fileInput.current?.click()}>
                  Upload files
                </button>
                <button className="btn-ghost" onClick={() => setModal({ type: 'newFolder' })}>
                  <FolderPlus className="h-4 w-4" /> New folder
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Mobile upload button */}
      <button
        className="fixed right-5 bottom-5 z-20 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white shadow-lg shadow-brand/40 md:hidden"
        onClick={() => fileInput.current?.click()}
        aria-label="Upload"
      >
        <Plus className="h-6 w-6" />
      </button>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-brand/10 p-6 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-brand bg-white/90 px-12 py-10 dark:bg-slate-900/90">
            <CloudUpload className="h-12 w-12 text-brand" />
            <p className="font-medium">Drop to upload to {crumbs.at(-1)?.name ?? 'My Drive'}</p>
          </div>
        </div>
      )}

      {menu && <Menu {...menu} onClose={closeMenu} />}
      <TransferPanel />
      <Toasts />

      {modal?.type === 'newFolder' && (
        <PromptDialog
          title="New folder"
          initial="Untitled folder"
          confirmLabel="Create"
          onSubmit={async (name) => void (await createFolder(useDrive.getState().drive, current, name))}
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
            toast(`Moved ${modal.items.length === 1 ? `“${modal.items[0].name}”` : `${modal.items.length} items`}`)
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'delete' && (
        <ConfirmDialog
          title="Delete permanently?"
          danger
          confirmLabel="Delete"
          message={<DeleteMessage items={modal.items} />}
          onConfirm={async () => {
            await remove(useDrive.getState().drive, modal.items)
            toast('Deleted')
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'details' && (
        <DetailsDialog
          drive={drive}
          item={modal.item}
          onDownload={() => {
            if (modal.item.kind === 'file') void download(modal.item)
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
