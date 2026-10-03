import {
  ArchiveRestore, ArrowDownAZ, ArrowUpAZ, Camera, Clock, CloudUpload, Download, Eye, FolderInput, FolderOpen, FolderPlus,
  FolderUp, HardDrive, Images, Info, LayoutGrid, Loader2, List, Menu as MenuIcon, Pencil, Plus, RefreshCw, Search, Star, StarOff,
  Trash2, TriangleAlert, Upload, X, ExternalLink, KeyRound, Lock, LockOpen, MonitorSmartphone, RefreshCcwDot, Send,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import ConfirmDialog from '../components/dialogs/ConfirmDialog'
import DetailsDialog from '../components/dialogs/DetailsDialog'
import MoveDialog from '../components/dialogs/MoveDialog'
import PromptDialog from '../components/dialogs/PromptDialog'
import FileView, { sortItems } from '../components/FileView'
import Menu, { type MenuEntry, type MenuHeader } from '../components/Menu'
import Thumb from '../components/Thumb'
import Preview from '../components/Preview'
import Sidebar from '../components/Sidebar'
import Toasts from '../components/Toasts'
import TransferPanel from '../components/TransferPanel'
import { downloadFile, downloadZip, pickSaveTarget, pickSaveTargets } from '../drive/download'
import { ROOT } from '../drive/meta'
import {
  createFolder, deleteMessages, emptyTrash, filesToReencrypt, move, relockItem, remove, rename, restore, setStarred, trash,
  TRASH_DAYS,
} from '../drive/ops'
import { enqueue } from '../drive/queue'
import {
  breadcrumbs, childLevel, collectTree, containsLocked, messageIds, findDuplicate, hasFileOfSize, isHidden, listFolder, zipEntries, locationOf, recentFiles, searchItems, starredItems, trashedItems, uniqueName,
  type Drive, type FileItem, type Item,
} from '../drive/tree'
import PhotoTimeline, { sortPhotos } from '../components/PhotoTimeline'
import { discard, findResumable, uploadFile, type UploadSource } from '../drive/upload'
import { isAndroid, openWithOtherApp, phoneSaveTarget, type PhoneSaveTarget } from '../native/android'
import { useBackHandler } from '../native/backButton'
import { useIncomingShares } from '../native/share'
import CameraBackupDialog from '../components/dialogs/CameraBackupDialog'
import Dialog from '../components/Dialog'
import GetApps from '../components/GetApps'
import ThemeButton from '../components/ThemeButton'
import { isDesktop } from '../native/desktop'
import SettingsView from './Settings'
import LockDialog, { type LockAction } from '../components/dialogs/LockDialog'
import DuplicatesDialog, { type Duplicate } from '../components/dialogs/DuplicatesDialog'
import SendDialog from '../components/dialogs/SendDialog'
import { cantSend } from '../telegram/share'
import { sha256 } from '../drive/hash'
import { createFolders, treeFromDrop, treeFromInput, type PickedTree } from '../drive/folderUpload'
import { closeAllLocks, holdOpen } from '../drive/keyring'
import { DriveFileUpload } from '../drive/stream'
import { FILTERS, formatBytes, formatDate, type FilterKey } from '../lib/format'
import { useDrive, useInPhotos, useRootName, type SortKey } from '../store/useDrive'
import { useBackup } from '../native/backup'
import { driveName } from '../telegram/channel'
import { toast, toastError } from '../store/useToast'

export type Mode = 'folder' | 'search' | 'recent' | 'starred' | 'trash' | 'settings'

type Modal =
  | { type: 'newFolder' }
  | { type: 'rename'; item: Item }
  | { type: 'move'; items: Item[] }
  | { type: 'deleteForever'; items: Item[] }
  | { type: 'emptyTrash' }
  | { type: 'trashLocked'; items: Item[] }
  | { type: 'details'; item: Item }
  | { type: 'logout' }
  | { type: 'backup' }
  | { type: 'getApps' }
  | { type: 'lock'; item: Item; action: LockAction; then?: (item: Item) => void }
  | { type: 'send'; files: FileItem[] }
  | { type: 'newDrive' }
  | { type: 'duplicates'; duplicates: Duplicate[]; total: number; onSkip: () => void; onUploadAll: () => void }

/** A file to upload and the folder it goes into. */
interface UploadJob {
  file: UploadSource
  folder: string
}

const SORT_LABELS: Record<SortKey, string> = { name: 'Name', date: 'Date', size: 'Size', type: 'Type' }
const TITLES: Record<Mode, string> = { folder: 'My Drive', search: 'Search', recent: 'Recent', starred: 'Starred', trash: 'Trash', settings: 'Settings' }

const act = (p: Promise<unknown>) => p.catch(toastError)

/** The app's own features (camera backup). In development, `?mock&app` shows them in the browser too. */
/** The website (not the Windows or Android app): offers the apps for download. */
const isWebsite = !isAndroid && !isDesktop
const appUi = isAndroid || (import.meta.env.DEV && new URLSearchParams(location.search).has('app'))

/** The folder being browsed before a search started, so leaving the search goes back there. */
let lastFolderPath = '/'

export default function DrivePage({ mode }: { mode: Mode }) {
  const { folderId = ROOT } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { drive, view, sort, syncing, syncError, setView, setSort, refresh, logout } = useDrive()
  const anyUnlocked = useMemo(() => [...drive.items.values()].some((i) => i.lock && !i.locked), [drive])
  const rootName = useRootName()
  const inPhotos = useInPhotos()
  const [modal, setModal] = useState<Modal | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[]; header?: MenuHeader } | null>(null)
  const [preview, setPreview] = useState<{ files: FileItem[]; index: number } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [drawer, setDrawer] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const shares = useIncomingShares((s) => s.files)
  const clearShares = useIncomingShares((s) => s.clear)

  const query = params.get('q') ?? ''
  // The input keeps its own text; the URL follows it (reading back from the URL drops fast keystrokes)
  const [searchText, setSearchText] = useState(mode === 'search' ? query : '')
  const filter = (params.get('type') as FilterKey | null) ?? null
  const folderExists = folderId === ROOT || drive.items.get(folderId)?.kind === 'folder'
  const current = mode === 'folder' && folderExists ? folderId : ROOT
  const crumbs = mode === 'folder' ? breadcrumbs(drive, current) : []
  // TelePhotos: its top and Starred are a timeline of every photo and video (by date taken), not folders
  const timeline = inPhotos && ((mode === 'folder' && current === ROOT) || mode === 'starred')
  /** Timeline chip: a source folder's ID (Camera, Screenshots…), or "videos". */
  const source = timeline && mode === 'folder' ? params.get('src') : null
  const sources = useMemo(
    () => (timeline && mode === 'folder' ? listFolder(drive, ROOT).filter((i) => i.kind === 'folder' && !i.locked) : []),
    [drive, timeline, mode],
  )

  const items = useMemo(() => {
    const match = filter && FILTERS[filter] ? FILTERS[filter].match : undefined
    if (timeline) return timelineItems(drive, { starred: mode === 'starred', source })
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
      case 'settings':
        return []
    }
  }, [drive, mode, current, query, filter, sort, timeline, source])

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const selection = [...selected].flatMap((id) => byId.get(id) ?? [])

  // A file that just locked again (or vanished into a locked folder) can't stay on screen
  useEffect(() => {
    const f = preview?.files[preview.index]
    const now = f && drive.items.get(f.id)
    if (f && (!now || now.locked || now.concealed)) setPreview(null)
  }, [drive, preview])

  // Selection belongs to the page being viewed
  useEffect(() => {
    setSelected(new Set())
    setAnchor(null)
  }, [location.pathname, location.search])

  useEffect(() => {
    if (mode === 'search') searchInput.current?.focus()
    else setSearchText('')
  }, [mode])

  useEffect(() => {
    if (mode === 'folder') lastFolderPath = location.pathname
  }, [mode, location.pathname])

  // Android back button: close the drawer, then clear the selection
  useBackHandler(drawer, () => setDrawer(false))
  useBackHandler(selected.size > 0, () => setSelected(new Set()))

  const openFolder = (id: string) => navigate(id === ROOT ? '/' : `/folder/${id}`)
  const closeMenu = useCallback(() => setMenu(null), [])
  const clearSelection = () => setSelected(new Set())

  // ---- Actions ----

  const newFolder = () => setModal({ type: 'newFolder' })

  const upload = async (all: UploadSource[], into?: string) => {
    // TelePhotos only takes photos and videos
    const files = inPhotos ? all.filter(isMedia) : all
    if (files.length < all.length) {
      const n = all.length - files.length
      toast(`${n} file${n === 1 ? ' isn’t a photo or video' : 's aren’t photos or videos'}, skipped. Files go in My Drive.`)
    }
    if (!files.length) return
    const target = into ?? (mode === 'folder' ? current : ROOT)
    if (!into && (target !== current || mode !== 'folder')) toast(`Uploading to ${rootName}`)
    await queueUploads(files.map((file) => ({ file, folder: target })))
  }

  /** Upload a picked or dropped folder: recreate its folders, then upload the files into them. */
  const uploadTree = (tree: PickedTree, into?: string) => {
    // No folders in TelePhotos: just the photos and videos in it
    if (inPhotos) return void upload(tree.files.map((f) => f.file), into)
    const target = into ?? (mode === 'folder' ? current : ROOT)
    void act(
      (async () => {
        if (!tree.files.length && !tree.folders.length) return
        const n = tree.folders.length
        if (n > 1) toast(`Creating ${n} folders…`)
        const ids = await createFolders(() => useDrive.getState().drive, target, tree.folders)
        await queueUploads(tree.files.map(({ file, dirs }) => ({ file, folder: dirs.length ? ids.get(dirs.join('/'))! : target })))
        if (!tree.files.length) toast(n === 1 ? 'Folder created (it was empty)' : `${n} folders created (no files in them)`)
      })(),
    )
  }

  /** Check for duplicates (asking what to do if there are any), then queue the uploads. */
  const queueUploads = async (jobs: UploadJob[]) => {
    const drv = useDrive.getState().drive

    // Only files with the same size as one already in the drive can be duplicates; hash just those
    const hashes = new Map<UploadJob, string>()
    const duplicates = new Map<UploadJob, Duplicate>()
    const suspects = []
    for (const job of jobs) if (hasFileOfSize(drv, job.file.size) && !(await findResumable(job.file, job.folder))) suspects.push(job)
    if (suspects.length) toast('Checking for duplicates…')
    for (const job of suspects) {
      try {
        const hash = await sha256(job.file)
        hashes.set(job, hash)
        const existing = findDuplicate(drv, job.file.size, job.file.name, hash)
        if (existing) duplicates.set(job, { name: job.file.name, existing, location: locationOf(drv, existing, rootName) })
      } catch (e) {
        console.warn('Duplicate check failed', e)
      }
    }
    if (!duplicates.size) return enqueueUploads(jobs, hashes)
    setModal({
      type: 'duplicates',
      duplicates: [...duplicates.values()],
      total: jobs.length,
      onSkip: () => enqueueUploads(jobs.filter((j) => !duplicates.has(j)), hashes),
      onUploadAll: () => enqueueUploads(jobs, hashes),
    })
  }

  const enqueueUploads = async (jobs: UploadJob[], hashes: Map<UploadJob, string>) => {
    const drv = useDrive.getState().drive
    const taken = new Set<string>()
    for (const job of jobs) {
      const { file, folder } = job
      const resumable = await findResumable(file, folder)
      let name = resumable?.name ?? uniqueName(drv, folder, file.name)
      // Avoid clashes between files in the same batch
      for (let n = 1; !resumable && taken.has(`${folder}|${name.toLowerCase()}`); n++) {
        const dot = file.name.lastIndexOf('.')
        name = dot > 0 ? `${file.name.slice(0, dot)} (${n})${file.name.slice(dot)}` : `${file.name} (${n})`
      }
      taken.add(`${folder}|${name.toLowerCase()}`)
      if (resumable) toast(`Resuming upload of “${name}”`)
      const hash = hashes.get(job)
      enqueue('upload', name, file.size, (ctl) => uploadFile(file, name, folder, ctl, { level: childLevel(drv, folder), hash }), async () => {
        const state = await findResumable(file, folder)
        if (state) await discard(state)
      })
    }
  }

  const download = async (list: Item[]) => {
    const locked = list.find((i) => i.locked)
    if (locked) return list.length === 1 ? askUnlock(locked) : toastError(new Error('Unlock the locked items first'))
    if (list.some((i) => i.kind === 'folder')) return downloadAsZip(list)
    const files = list.filter((i): i is FileItem => i.kind === 'file' && i.complete)
    if (!files.length) return toastError(new Error("These files are incomplete and can't be downloaded"))
    if (files.length < list.length) toast('Incomplete files were skipped')
    // Must run first, while the click still counts as a user gesture
    const targets = await pickSaveTargets(files)
    if (!targets) return
    for (const f of files) {
      const target = targets.get(f.id)!
      enqueue('download', f.name, f.size, async (ctl) => {
        await downloadFile(f, target, ctl)
        const uri = (target as PhoneSaveTarget).uri
        if (uri) toast(`Saved “${f.name}” to Downloads/TeleDrive`, { label: 'Open', onClick: () => void act(openWithOtherApp(uri, f.mime)) })
      })
    }
  }

  const sendToTelegram = (list: Item[]) => {
    const files = list.filter((i): i is FileItem => i.kind === 'file')
    if (files.length < list.length) return toastError(new Error('Only files can be sent (not folders)'))
    const problem = files.map((f) => cantSend(f)).find(Boolean)
    if (problem) return toastError(new Error(files.length === 1 ? problem : `Some of these files can't be sent. ${problem}`))
    setModal({ type: 'send', files })
  }

  /** Folders (and everything in them) as one ZIP file. */
  const downloadAsZip = async (list: Item[]) => {
    const { entries, skipped, bytes } = zipEntries(useDrive.getState().drive, list)
    if (!entries.length) return toastError(new Error('Nothing to download'))
    const name = list.length === 1 ? `${list[0].name}.zip` : `TeleDrive ${new Date().toISOString().slice(0, 10)}.zip`
    // Must run first, while the click still counts as a user gesture
    const target = await pickSaveTarget({ name, mime: 'application/zip' })
    if (!target) return
    if (skipped) toast(`${skipped} locked or incomplete item${skipped === 1 ? ' was' : 's were'} left out of the ZIP`)
    enqueue('download', name, bytes, async (ctl) => {
      await downloadZip(entries, target, ctl)
      const uri = (target as PhoneSaveTarget).uri
      if (uri) toast(`Saved “${name}” to Downloads/TeleDrive`, { label: 'Open', onClick: () => void act(openWithOtherApp(uri, 'application/zip')) })
    })
  }

  /** Android: fetch into the app's cache, then hand it to another app (PDF viewer, etc.). */
  const openWith = (f: FileItem) => {
    if (!f.complete) return toastError(new Error('This file is incomplete and cannot be opened'))
    enqueue('download', f.name, f.size, async (ctl) => {
      const target = phoneSaveTarget(f.name, f.mime, 'cache')
      await downloadFile(f, target, ctl)
      await openWithOtherApp(target.uri!, f.mime)
    })
  }

  /** Locked items (or folders with locked items inside) need the TeleDrive password to be deleted. */
  const moveToTrash = async (list: Item[]) => {
    if (containsLocked(useDrive.getState().drive, list)) return setModal({ type: 'trashLocked', items: list })
    await trashNow(list)
  }

  const trashNow = async (list: Item[]) => {
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

  /** Ask for a locked item's password, then do `then` with the unlocked item (by default, open it). */
  const askUnlock = (item: Item, then: (item: Item) => void = open) =>
    setModal({
      type: 'lock',
      item,
      action: 'unlock',
      // The tree is rebuilt with its real name right after; wait for that
      then: (i) => void waitForItem(i.id, (x) => !x.locked).then((fresh) => fresh && then(fresh)),
    })

  /** Upload a locked item's files again with new keys, then delete the old copies. */
  const reencrypt = async (item: Item) => {
    const release = holdOpen()
    const fresh = await waitForItem(item.id, (i) => !!i.lock && !i.locked)
    if (!fresh) {
      release()
      return toastError(new Error('Unlock it first to re-encrypt it'))
    }
    const drv = useDrive.getState().drive
    const files = filesToReencrypt(drv, fresh).filter((f): f is FileItem => f.kind === 'file' && f.complete)
    if (!files.length) return release()
    let left = files.length
    toast(files.length === 1 ? `Re-encrypting “${files[0].name}”` : `Re-encrypting ${files.length} files`)
    for (const f of files) {
      enqueue('upload', `${f.name} (re-encrypting)`, f.size, async (ctl) => {
        try {
          await uploadFile(new DriveFileUpload(f), f.name, f.parent, ctl, { level: f.level, hash: f.hash, lock: f.lock, flags: f.x })
          await deleteMessages(messageIds([f]))
        } finally {
          if (--left === 0) release()
        }
      })
    }
  }

  const open = (item: Item) => {
    if (mode === 'trash') return setModal({ type: 'details', item })
    if (item.locked) return askUnlock(item)
    if (item.kind === 'folder') return openFolder(item.id)
    const files = items.filter((i): i is FileItem => i.kind === 'file' && !i.locked)
    setPreview({ files, index: files.findIndex((f) => f.id === item.id) })
  }

  // ---- Selection ----

  const selectMany = (ids: string[], on: boolean) => {
    const next = new Set(selected)
    for (const id of ids) {
      if (on) next.add(id)
      else next.delete(id)
    }
    setSelected(next)
  }

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
    if (item.locked)
      return [
        { label: 'Unlock', icon: LockOpen, onClick: () => askUnlock(item) },
        { label: 'Move', icon: FolderInput, onClick: () => setModal({ type: 'move', items: [item] }) },
        { label: 'Details', icon: Info, onClick: () => setModal({ type: 'details', item }) },
        { label: 'Move to trash', icon: Trash2, danger: true, onClick: () => void act(moveToTrash([item])) },
      ]
    return [
      item.kind === 'file'
        ? { label: 'Preview', icon: Eye, onClick: () => open(item) }
        : { label: 'Open', icon: FolderOpen, onClick: () => openFolder(item.id) },
      item.kind === 'file'
        ? { label: 'Download', icon: Download, onClick: () => void download([item]), disabled: !item.complete }
        : { label: 'Download as ZIP', icon: Download, onClick: () => void download([item]) },
      ...(isAndroid && item.kind === 'file'
        ? [{ label: 'Open with…', icon: ExternalLink, onClick: () => openWith(item), disabled: !item.complete }]
        : []),
      ...(item.kind === 'file'
        ? [{ label: 'Send to Telegram…', icon: Send, onClick: () => sendToTelegram([item]), disabled: !!cantSend(item) }]
        : []),
      ...(mode !== 'folder' ? [{ label: 'Show in folder', icon: FolderInput, onClick: () => openFolder(item.parent) }] : []),
      { label: 'Rename', icon: Pencil, onClick: () => setModal({ type: 'rename', item }) },
      { label: 'Move', icon: FolderInput, onClick: () => setModal({ type: 'move', items: [item] }) },
      item.x.fav
        ? { label: 'Remove from Starred', icon: StarOff, onClick: () => void act(toggleStar([item])) }
        : { label: 'Add to Starred', icon: Star, onClick: () => void act(toggleStar([item])) },
      ...(item.lock
        ? [
            { label: 'Lock now', icon: Lock, onClick: () => relockItem(item) },
            { label: 'Change password…', icon: KeyRound, onClick: () => setModal({ type: 'lock', item, action: 'change' }) },
            { label: 'Re-encrypt', icon: RefreshCcwDot, onClick: () => void act(reencrypt(item)) },
            { label: 'Remove lock…', icon: LockOpen, onClick: () => setModal({ type: 'lock', item, action: 'remove' }) },
          ]
        : [{ label: 'Lock…', icon: Lock, onClick: () => setModal({ type: 'lock', item, action: 'lock' }) }]),
      { label: 'Details', icon: Info, onClick: () => setModal({ type: 'details', item }) },
      { label: 'Move to trash', icon: Trash2, danger: true, onClick: () => void act(moveToTrash([item])) },
    ]
  }

  /** The item's name above its actions in the phone's bottom sheet. */
  const itemHeader = (item: Item): MenuHeader => ({
    title: item.name,
    subtitle: item.kind === 'file' && !item.locked ? `${formatBytes(item.size)} · ${formatDate(item.ts)}` : formatDate(item.ts),
    icon: (
      <div className="size-10 shrink-0 overflow-hidden rounded-md bg-surface raised-sm">
        <Thumb item={item} iconClass="size-5" />
      </div>
    ),
  })

  const sortMenu = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    setMenu({
      x: r.left,
      y: r.bottom + 4,
      header: { title: 'Sort by' },
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
  const setFilter = (type: FilterKey | null) => {
    // "All" with nothing typed means there's nothing to search: go back to browsing
    if (!type && !query) return exitSearch()
    setSearch(query, type)
  }

  const exitSearch = () => navigate(lastFolderPath)

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
      if (!e.dataTransfer.items?.length) return void upload(Array.from(e.dataTransfer.files))
      // Walks dropped folders too (has to start while the drop event is running)
      treeFromDrop(e.dataTransfer.items).then(
        (tree) => (tree.folders.length ? uploadTree(tree) : void upload(tree.files.map((f) => f.file))),
        toastError,
      )
    },
  }

  const switchDrive = (id: string) => {
    if (id === useDrive.getState().currentDrive) return
    // Folder links belong to one drive, so start at the top of the other one
    navigate('/')
    void act(useDrive.getState().switchDrive(id))
  }
  const openPhotos = () => {
    navigate('/')
    if (!inPhotos) void act(useDrive.getState().openPhotos())
  }

  const sidebar = (
    <Sidebar
      onUpload={() => fileInput.current?.click()}
      // Android's file picker can't pick folders
      onUploadFolder={isAndroid ? undefined : () => folderInput.current?.click()}
      onNewFolder={newFolder}
      onLogout={() => setModal({ type: 'logout' })}
      onLockAll={anyUnlocked ? closeAllLocks : undefined}
      onSwitchDrive={switchDrive}
      onOpenPhotos={openPhotos}
      onNewDrive={() => setModal({ type: 'newDrive' })}
      onCameraBackup={appUi && inPhotos ? () => setModal({ type: 'backup' }) : undefined}
      onGetApps={() => setModal({ type: 'getApps' })}
    />
  )

  const subtitle =
    mode === 'folder'
      ? undefined
      : mode === 'trash'
        ? (i: Item) => `Deleted ${formatDate(i.x.tr ?? 0)} · from ${locationOf(drive, i, rootName)}`
        : (i: Item) => locationOf(drive, i, rootName)

  const fabEntries: MenuEntry[] = inPhotos
    ? [{ label: 'Upload photos', icon: Upload, onClick: () => fileInput.current?.click() }]
    : [
        { label: 'Upload files', icon: Upload, onClick: () => fileInput.current?.click() },
        ...(isAndroid ? [] : [{ label: 'Upload folder', icon: FolderUp, onClick: () => folderInput.current?.click() }]),
        { label: 'New folder', icon: FolderPlus, onClick: newFolder },
      ]
  const title = mode === 'folder' ? (crumbs.at(-1)?.name ?? rootName) : TITLES[mode]
  const count =
    mode === 'search'
      ? query || filter
        ? items.length === 500
          ? 'first 500 results'
          : `${items.length} result${items.length === 1 ? '' : 's'}`
        : ''
      : timeline
        ? `${items.length} photo${items.length === 1 ? '' : 's'}`
        : `${items.length} item${items.length === 1 ? '' : 's'}`

  return (
    <div className="flex h-full md:gap-4.5 md:p-4.5" {...dropHandlers}>
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={inPhotos ? 'image/*,video/*' : undefined}
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void upload(Array.from(e.target.files))
          e.target.value = ''
        }}
      />
      <input
        ref={folderInput}
        type="file"
        hidden
        {...{ webkitdirectory: '' }}
        onChange={(e) => {
          if (e.target.files?.length) uploadTree(treeFromInput(Array.from(e.target.files)))
          e.target.value = ''
        }}
      />

      <aside className="panel hidden w-64 shrink-0 md:block">{sidebar}</aside>
      {drawer && (
        <div className="fixed inset-0 z-40 bg-scrim md:hidden" onClick={() => setDrawer(false)}>
          <aside className="h-full w-72 rounded-r-md bg-surface lift" onClick={(e) => e.stopPropagation()}>
            {/* Close after the tapped button has handled the click (not in the capture phase, which runs first) */}
            <div onClick={() => setDrawer(false)} className="h-full">
              {sidebar}
            </div>
          </aside>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        {mode === 'settings' ? (
          <>
            <header className="flex min-h-11 items-center gap-2.5 px-4 pt-4 md:hidden">
              <button className="icon-btn" onClick={() => setDrawer(true)} aria-label="Menu">
                <MenuIcon />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-4 pt-5 pb-28 md:-mx-4.5 md:-mb-4.5 md:px-4.5 md:pt-6 md:pb-8">
              <h1 className="h-display mb-6 md:mb-8">Settings</h1>
              <SettingsView onGetApps={isWebsite ? () => setModal({ type: 'getApps' }) : undefined} />
            </div>
          </>
        ) : (
          <>
        <header className="flex min-h-11 items-center gap-2.5 px-4 pt-4 md:gap-3 md:px-0 md:pt-0">
          {selection.length ? (
            <SelectionBar
              count={selection.length}
              trashMode={mode === 'trash'}
              allStarred={selection.every((i) => i.x.fav)}
              onClear={clearSelection}
              onDownload={() => void download(selection)}
              onSend={() => sendToTelegram(selection)}
              onMove={() => setModal({ type: 'move', items: selection })}
              onStar={() => void act(toggleStar(selection))}
              onTrash={() => void act(moveToTrash(selection))}
              onRestore={() => void act(restoreItems(selection))}
              onDeleteForever={() => setModal({ type: 'deleteForever', items: selection })}
            />
          ) : (
            <>
              <button className="icon-btn md:hidden" onClick={() => setDrawer(true)} aria-label="Menu">
                <MenuIcon />
              </button>
              <div className={`relative min-w-0 flex-1 ${mode === 'search' ? '' : 'hidden md:block'}`}>
                <Search className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted" />
                <input
                  ref={searchInput}
                  type="text"
                  role="searchbox"
                  enterKeyHint="search"
                  placeholder="Search in TeleDrive"
                  className="input pr-10 pl-10.5"
                  value={searchText}
                  onChange={(e) => {
                    setSearchText(e.target.value)
                    setSearch(e.target.value.trim())
                  }}
                  onKeyDown={(e) => e.key === 'Escape' && mode === 'search' && exitSearch()}
                />
                {mode === 'search' && (searchText || filter) && (
                  <button
                    className="absolute top-1/2 right-1.5 -translate-y-1/2 icon-btn-flat"
                    onClick={exitSearch}
                    aria-label="Clear search"
                  >
                    <X />
                  </button>
                )}
              </div>
              {mode !== 'search' && <div className="flex-1 md:hidden" />}
              {mode !== 'search' && (
                <button className="icon-btn md:hidden" onClick={() => setSearch('')} aria-label="Search">
                  <Search />
                </button>
              )}
              {syncError && (
                <span title={syncError} className="text-brand-ink">
                  <TriangleAlert className="size-5" />
                </span>
              )}
              <div className={`hidden h-11 shrink-0 gap-1 rounded-md p-1 pressed ${timeline ? '' : 'md:flex'}`} role="group" aria-label="View">
                {(['list', 'grid'] as const).map((v) => {
                  const Icon = v === 'list' ? List : LayoutGrid
                  return (
                    <button
                      key={v}
                      aria-pressed={view === v}
                      onClick={() => setView(v)}
                      className={`flex items-center gap-1.5 rounded-md px-3 text-[13px] transition-[box-shadow,color] duration-120 [&_svg]:size-4 ${
                        view === v ? 'bg-surface font-extrabold text-brand-ink raised-sm' : 'font-semibold text-muted hover:text-ink'
                      }`}
                    >
                      <Icon /> {v === 'list' ? 'List' : 'Grid'}
                    </button>
                  )
                })}
              </div>
              <button
                className={`icon-btn md:hidden ${timeline ? 'hidden' : ''}`}
                onClick={() => setView(view === 'grid' ? 'list' : 'grid')}
                aria-label={view === 'grid' ? 'List view' : 'Grid view'}
              >
                {view === 'grid' ? <List /> : <LayoutGrid />}
              </button>
              {mode !== 'recent' && mode !== 'trash' && !timeline && (
                <button className="icon-btn" onClick={sortMenu} aria-label="Sort" title={`Sort by ${SORT_LABELS[sort.key]}`}>
                  {sort.dir === 'asc' ? <ArrowDownAZ /> : <ArrowUpAZ />}
                </button>
              )}
              <button className="icon-btn hidden md:inline-flex" onClick={() => void refresh()} aria-label="Refresh" title="Refresh">
                <RefreshCw className={syncing ? 'animate-spin' : ''} />
              </button>
              <ThemeButton />
            </>
          )}
        </header>

        {/* Scrolls under the header; the negative margins leave room for the panels' shadows */}
        <div
          ref={scroller}
          className="flex-1 overflow-y-auto px-4 pt-5 pb-44 md:-mx-4.5 md:-mb-4.5 md:px-4.5 md:pt-6 md:pb-8"
          onClick={(e) => e.target === e.currentTarget && clearSelection()}
        >
          <div className="mb-4 md:mb-5">
            {mode === 'folder' && crumbs.length > 0 && (
              <nav className="mb-2 flex min-w-0 items-center gap-1.5 overflow-x-auto text-[15px] font-bold whitespace-nowrap" aria-label="Folders">
                {[{ id: ROOT, name: rootName }, ...crumbs.slice(0, -1)].map((f) => (
                  <span key={f.id} className="flex items-center gap-1.5">
                    <button className="rounded-md text-muted hover:text-ink" onClick={() => openFolder(f.id)}>
                      {f.name}
                    </button>
                    <span className="text-brand-ink">/</span>
                  </span>
                ))}
              </nav>
            )}
            <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
              <h1 className="h-display min-w-0 truncate">{title}</h1>
              {count && <span className="pb-0.5 text-sm text-muted">{count}</span>}
              {mode === 'trash' && items.length > 0 && (
                <button className="btn-danger-solid ml-auto" onClick={() => setModal({ type: 'emptyTrash' })}>
                  <Trash2 /> Empty trash
                </button>
              )}
            </div>
            {mode === 'trash' && items.length > 0 && (
              <p className="mt-2 text-sm text-muted">Items in the trash are deleted forever after {TRASH_DAYS} days.</p>
            )}
            {appUi && <BackupNotice inPhotos={inPhotos} onOpenPhotos={openPhotos} />}
          </div>
          {timeline && mode === 'folder' && (
            <div className="-mx-4 mb-4 flex gap-2.5 overflow-x-auto px-4 pt-1 pb-3 md:-mx-4.5 md:mb-3 md:px-4.5">
              {[{ id: null, name: 'All' }, ...sources.map((f) => ({ id: f.id, name: f.name })), { id: 'videos', name: 'Videos' }].map((c) => (
                <button
                  key={c.id ?? 'all'}
                  className={source === c.id ? 'chip-active' : 'chip'}
                  onClick={() => setParams(c.id ? { src: c.id } : {}, { replace: true })}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
          {(mode === 'folder' || mode === 'search') && !timeline && (
            <div className="-mx-4 mb-4 flex gap-2.5 overflow-x-auto px-4 pt-1 pb-3 md:-mx-4.5 md:mb-3 md:px-4.5">
              <button className={mode === 'search' && filter ? 'chip' : 'chip-active'} onClick={() => setFilter(null)}>
                All
              </button>
              {(Object.keys(FILTERS) as FilterKey[]).filter((key) => !inPhotos || key === 'image' || key === 'video').map((key) => (
                <button key={key} className={mode === 'search' && filter === key ? 'chip-active' : 'chip'} onClick={() => setFilter(filter === key ? null : key)}>
                  {FILTERS[key].label}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-start gap-4.5">
            <div className="min-w-0 flex-1">
              {timeline && items.length ? (
                <PhotoTimeline
                  key={`${mode}|${source ?? ''}`}
                  items={items as FileItem[]}
                  selected={selected}
                  scroller={scroller}
                  onClick={onItemClick}
                  onToggle={toggle}
                  onSelectMany={selectMany}
                  onMenu={(item, x, y) => setMenu({ x, y, entries: itemMenu(item), header: itemHeader(item) })}
                />
              ) : items.length ? (
                <FileView
                  items={items}
                  view={view}
                  selected={selected}
                  onClick={onItemClick}
                  onToggle={toggle}
                  onMenu={(item, x, y) => setMenu({ x, y, entries: itemMenu(item), header: itemHeader(item) })}
                  subtitle={subtitle}
                />
              ) : (
                <EmptyState
                  mode={mode}
                  filtered={!!filter}
                  searched={!!query}
                  isRoot={current === ROOT}
                  photos={inPhotos}
                  onUpload={() => fileInput.current?.click()}
                  onNewFolder={newFolder}
                />
              )}
            </div>
            <TransferPanel className="sticky top-0 hidden w-72 shrink-0 lg:block" />
          </div>
        </div>
          </>
        )}
      </main>

      {/* Phone: + button and transfers above the tabs; tablet: transfers in the corner */}
      <div className="pointer-events-none fixed inset-x-3 bottom-[96px] z-30 flex flex-col items-end gap-3 md:inset-x-auto md:right-4.5 md:bottom-4.5 md:w-80 lg:hidden">
        {!selection.length && mode !== 'settings' && (
          <button
            className="pointer-events-auto mr-3 flex size-15 items-center justify-center rounded-[10px] bg-brand text-white raised-md active:pressed md:hidden"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setMenu({ x: r.right - 224, y: r.top - 8, entries: fabEntries, header: { title: 'New' } })
            }}
            aria-label="New"
          >
            <Plus className="size-6.5" strokeWidth={2.4} />
          </button>
        )}
        <TransferPanel className="pointer-events-auto w-full" />
      </div>
      <BottomNav
        photos={inPhotos}
        onBackup={appUi && inPhotos ? () => setModal({ type: 'backup' }) : undefined}
        onPhotos={appUi && !inPhotos ? openPhotos : undefined}
      />

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6">
          <div className="flex flex-col items-center gap-3 rounded-md bg-surface px-12 py-10 outline-2 outline-offset-4 outline-brand outline-dashed lift">
            <CloudUpload className="size-12 text-brand-ink" strokeWidth={1.6} />
            <p className="font-bold">Drop to upload to {mode === 'folder' ? (crumbs.at(-1)?.name ?? rootName) : rootName}</p>
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
          onOpenWith={openWith}
        />
      )}
      {menu && <Menu {...menu} onClose={closeMenu} />}
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
          requirePassword={
            containsLocked(drive, modal.items) ? 'Locked items are included. Enter your TeleDrive password to delete them.' : undefined
          }
          onConfirm={async () => {
            await remove(useDrive.getState().drive, modal.items)
            clearSelection()
            toast('Deleted forever')
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'trashLocked' && (
        <ConfirmDialog
          title="Move to trash?"
          danger
          confirmLabel="Move to trash"
          message={
            modal.items.length === 1 && modal.items[0].lock
              ? `“${modal.items[0].name}” is locked. Items in the trash are deleted forever after ${TRASH_DAYS} days.`
              : `This includes locked items. Items in the trash are deleted forever after ${TRASH_DAYS} days.`
          }
          requirePassword="Enter your TeleDrive password to confirm it's you."
          onConfirm={() => trashNow(modal.items)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'emptyTrash' && (
        <ConfirmDialog
          title="Empty trash?"
          danger
          confirmLabel="Empty trash"
          message="Everything in the trash will be deleted from Telegram. This can't be undone."
          requirePassword={
            containsLocked(drive, trashedItems(drive))
              ? 'The trash has locked items. Enter your TeleDrive password to delete them.'
              : undefined
          }
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
      {modal?.type === 'backup' && <CameraBackupDialog onClose={() => setModal(null)} />}
      {modal?.type === 'getApps' && (
        <Dialog title="Get the app" icon={MonitorSmartphone} subtitle="TeleDrive for Windows and Android" onClose={() => setModal(null)}>
          <GetApps heading={false} />
        </Dialog>
      )}
      {modal?.type === 'newDrive' && (
        <PromptDialog
          title="New drive"
          initial="Work"
          confirmLabel="Create"
          onSubmit={async (name) => {
            navigate('/')
            await useDrive.getState().createDrive(name)
            toast(`Created the “${name.trim()}” drive`)
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'send' && <SendDialog files={modal.files} onClose={() => setModal(null)} />}
      {modal?.type === 'duplicates' && (
        <DuplicatesDialog
          duplicates={modal.duplicates}
          total={modal.total}
          onSkip={() => {
            setModal(null)
            void modal.onSkip()
          }}
          onUploadAll={() => {
            setModal(null)
            void modal.onUploadAll()
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'lock' && (
        <LockDialog
          item={modal.item}
          action={modal.action}
          onUnlocked={modal.then}
          onReencrypt={(item) => void act(reencrypt(item))}
          onClose={() => setModal(null)}
        />
      )}
      {shares.length > 0 && !modal && (
        <MoveDialog
          drive={drive}
          items={[]}
          title={`Save ${shares.length === 1 ? `“${shares[0].name}”` : `${shares.length} files`} to TeleDrive`}
          confirmLabel="Save here"
          initialFolder={mode === 'folder' ? current : ROOT}
          onMove={async (target) => {
            const files = shares
            clearShares()
            await upload(files, target)
          }}
          onClose={clearShares}
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
  onSend: () => void
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
        <X />
      </button>
      <span className="min-w-0 flex-1 truncate text-[15px] font-extrabold">{p.count} selected</span>
      {p.trashMode ? (
        <>
          <button className="btn-secondary px-3.5 sm:px-4.5" onClick={p.onRestore} aria-label="Restore">
            <ArchiveRestore /> <span className="hidden sm:inline">Restore</span>
          </button>
          <button className="btn-danger-solid px-3.5 sm:px-4.5" onClick={p.onDeleteForever} aria-label="Delete forever">
            <Trash2 /> <span className="hidden sm:inline">Delete forever</span>
          </button>
        </>
      ) : (
        <>
          <button className="icon-btn" onClick={p.onDownload} aria-label="Download" title="Download">
            <Download />
          </button>
          <button className="icon-btn hidden sm:inline-flex" onClick={p.onSend} aria-label="Send to Telegram" title="Send to Telegram">
            <Send />
          </button>
          <button className="icon-btn" onClick={p.onMove} aria-label="Move" title="Move">
            <FolderInput />
          </button>
          <button
            className="icon-btn"
            onClick={p.onStar}
            aria-label={p.allStarred ? 'Unstar' : 'Star'}
            title={p.allStarred ? 'Remove from Starred' : 'Add to Starred'}
          >
            {p.allStarred ? <StarOff /> : <Star />}
          </button>
          <button className="icon-btn text-brand-ink" onClick={p.onTrash} aria-label="Move to trash" title="Move to trash">
            <Trash2 />
          </button>
        </>
      )}
    </>
  )
}

function EmptyState(props: {
  mode: Exclude<Mode, 'settings'>
  filtered: boolean
  searched: boolean
  isRoot: boolean
  /** In TelePhotos. */
  photos: boolean
  onUpload: () => void
  onNewFolder: () => void
}) {
  const { mode, filtered, searched, isRoot, photos, onUpload, onNewFolder } = props
  const content: Record<Exclude<Mode, 'settings'>, { icon: typeof Search; title: string; text: string }> = {
    folder: photos
      ? {
          icon: Images,
          title: isRoot ? 'No photos yet' : 'Nothing here yet',
          text: isAndroid ? 'Turn on Camera backup, or upload photos and videos.' : 'Drop photos and videos here, or use Upload.',
        }
      : { icon: CloudUpload, title: isRoot ? 'Your drive is empty' : 'Nothing here yet', text: 'Drop files or folders here, or use Upload.' },
    search: searched || filtered
      ? { icon: Search, title: 'No results', text: 'Try a different name or filter.' }
      : { icon: Search, title: 'Search your drive', text: 'Type a file or folder name, or pick a filter.' },
    recent: { icon: Clock, title: 'No recent files', text: 'Files you upload will show up here.' },
    starred: { icon: Star, title: 'Nothing starred yet', text: 'Star files and folders to find them quickly.' },
    trash: { icon: Trash2, title: 'Trash is empty', text: `Deleted items stay here for ${TRASH_DAYS} days.` },
  }
  const { icon: Icon, title, text } = content[mode]
  return (
    <div className="flex min-h-80 flex-col items-center justify-center gap-3.5 rounded-md px-7 py-11 text-center pressed-lg">
      <div className="flex size-18 items-center justify-center rounded-md bg-surface text-muted raised-md">
        <Icon className="size-8" strokeWidth={1.6} />
      </div>
      <p className="text-[22px] font-black tracking-[-0.02em]">{title}</p>
      <p className="max-w-80 text-sm text-muted">{text}</p>
      {mode === 'folder' && (
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          <button className="btn-primary" onClick={onUpload}>
            <Upload /> {photos ? 'Upload photos' : 'Upload files'}
          </button>
          {!photos && (
            <button className="btn-secondary" onClick={onNewFolder}>
              <FolderPlus /> New folder
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Phone tabs. The fourth: in the app, Photos (opens TelePhotos) in other drives and Camera backup in TelePhotos;
 * Trash on the website.
 */
function BottomNav({ photos, onBackup, onPhotos }: { photos: boolean; onBackup?: () => void; onPhotos?: () => void }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const tabs = [
    {
      label: photos ? 'Photos' : 'Drive',
      icon: photos ? Images : HardDrive,
      on: pathname === '/' || pathname.startsWith('/folder/'),
      go: () => navigate('/'),
    },
    { label: 'Recent', icon: Clock, on: pathname === '/recent', go: () => navigate('/recent') },
    { label: 'Starred', icon: Star, on: pathname === '/starred', go: () => navigate('/starred') },
    onBackup
      ? { label: 'Backup', icon: Camera, on: false, go: onBackup }
      : onPhotos
        ? { label: 'Photos', icon: Images, on: false, go: onPhotos }
        : { label: 'Trash', icon: Trash2, on: pathname === '/trash', go: () => navigate('/trash') },
  ]
  return (
    <nav className="fixed inset-x-3 bottom-3 z-20 flex h-18 items-center justify-around rounded-md bg-surface raised-md md:hidden">
      {tabs.map((t) => (
        <button
          key={t.label}
          onClick={t.go}
          aria-current={t.on ? 'page' : undefined}
          className={`flex min-w-16 flex-col items-center gap-1 text-[11px] ${t.on ? 'font-extrabold text-brand-ink' : 'font-semibold text-muted'}`}
        >
          <span className={`flex h-8 w-14 items-center justify-center rounded-md ${t.on ? 'pressed-xs' : ''}`}>
            <t.icon className="size-5" strokeWidth={t.on ? 2 : 1.8} />
          </span>
          {t.label}
        </button>
      ))}
    </nav>
  )
}

function DeleteMessage({ items }: { items: Item[] }) {
  const drive = useDrive((s) => s.drive)
  const inside = items.reduce((n, i) => n + collectTree(drive, i.id).length - 1, 0)
  const what = items.length === 1 ? `“${items[0].name}”` : `${items.length} items`
  // Don't reveal how much a locked folder holds
  const hidden = items.some((i) => i.kind === 'folder' && i.locked)
  return (
    <p>
      {what}
      {hidden ? ' and everything inside' : inside > 0 && ` and ${inside} item${inside > 1 ? 's' : ''} inside`} will be deleted
      from Telegram. This can't be undone.
    </p>
  )
}

/** Wait until the rebuilt tree shows an item in the expected state (e.g. unlocked). */
function waitForItem(id: string, ok: (item: Item) => boolean, ms = 10_000): Promise<Item | undefined> {
  return new Promise((resolve) => {
    let finished = false
    const finish = (item?: Item) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      unsubscribe()
      resolve(item)
    }
    const check = () => {
      const item = useDrive.getState().drive.items.get(id)
      if (item && ok(item)) finish(item)
    }
    const timer = setTimeout(() => finish(), ms)
    const unsubscribe = useDrive.subscribe(check)
    check()
  })
}

/** Photos and videos (by type, else by extension), the only files TelePhotos takes. */
function isMedia(file: UploadSource): boolean {
  if (/^(image|video)\//.test(file.type)) return true
  return /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp|tiff?|dng|mp4|mov|m4v|webm|mkv|3gp|avi)$/i.test(file.name)
}

/**
 * Camera backup, seen from the drive page: photos waiting because another drive is open, or a background backup
 * that opened TelePhotos and goes back to the drive that was open when it's done.
 */
function BackupNotice({ inPhotos, onOpenPhotos }: { inPhotos: boolean; onOpenPhotos: () => void }) {
  const waiting = useBackup((s) => (s.settings.enabled ? s.waiting : 0))
  const returnName = useDrive((s) => {
    const d = s.returnTo ? s.drives.find((x) => x.id === s.returnTo) : undefined
    return d ? driveName(d) : null
  })
  const box = 'mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-3.5 py-2.5 text-sm pressed'
  if (inPhotos && returnName)
    return (
      <p className={box}>
        <Loader2 className="size-4 shrink-0 animate-spin text-muted" />
        <span>Backing up new photos. You'll go back to {returnName} when it's done.</span>
      </p>
    )
  if (inPhotos || !waiting) return null
  return (
    <p className={box}>
      <Camera className="size-4 shrink-0 text-muted" />
      <span>
        {waiting} photo{waiting === 1 ? '' : 's'} waiting to back up
      </span>
      <button className="font-bold text-brand-ink hover:underline" onClick={onOpenPhotos}>
        Open TelePhotos
      </button>
    </p>
  )
}

/** TelePhotos' timeline: every photo and video not in the trash or a locked folder, newest first by date taken. */
function timelineItems(drive: Drive, opts: { starred: boolean; source: string | null }): FileItem[] {
  const out: FileItem[] = []
  for (const i of drive.items.values()) {
    if (i.kind !== 'file' || i.locked || !/^(image|video)\//.test(i.mime)) continue
    if (opts.starred && !i.x.fav) continue
    if (opts.source === 'videos' ? !i.mime.startsWith('video/') : opts.source && topFolder(drive, i) !== opts.source) continue
    if (isHidden(drive, i)) continue
    out.push(i)
  }
  return sortPhotos(out)
}

/** The folder at the top of the drive an item is in (its own ID if it's at the top). */
function topFolder(drive: Drive, item: Item): string {
  let cur = item
  for (let n = 0; n < 100 && cur.parent !== ROOT; n++) {
    const up = drive.items.get(cur.parent)
    if (!up) break
    cur = up
  }
  return cur.id
}
