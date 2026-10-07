import {
  Dices, Download, Folder, FolderPlus, KeyRound, LayoutGrid, Lock, LockOpen, LogOut, Menu as MenuIcon, MonitorSmartphone, MousePointerClick, Pencil, Plus,
  ScanQrCode, Search, Settings, Star, Trash2, X, type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import ConfirmDialog from '../components/dialogs/ConfirmDialog'
import PromptDialog from '../components/dialogs/PromptDialog'
import Dialog from '../components/Dialog'
import DrivePicker from '../components/DrivePicker'
import GetApps from '../components/GetApps'
import Menu, { type MenuEntry } from '../components/Menu'
import ThemeButton from '../components/ThemeButton'
import Toasts from '../components/Toasts'
import { Choice } from '../components/ui'
import ItemForm from '../components/vault/ItemForm'
import { ItemDetail, ItemRow, itemMenu } from '../components/vault/ItemViews'
import { ImportDialog } from '../components/vault/DataDialogs'
import { AddCodeDialog, CodesPanel, ImportGoogleDialog } from '../components/vault/Otp'
import { TYPE_ICONS } from '../components/vault/parts'
import { RecoverDialog, ReminderDialog, reminderDue, ResetDialog, VaultLock, VaultSetup } from '../components/vault/VaultGate'
import { GeneratorPanel, VaultSettings } from '../components/vault/VaultPanels'
import { useSettings } from '../lib/settings'
import { isAndroid } from '../native/android'
import { useBackHandler } from '../native/backButton'
import { desktop, isDesktop } from '../native/desktop'
import { Native } from '../native/android'
import { useDrive } from '../store/useDrive'
import { newVaultId, useVault } from '../store/useVault'
import { toast, toastError } from '../store/useToast'
import { byName, matchesSearch, TYPE_NAMES, type ItemType, type VaultItem } from '../vault/items'
import SettingsView from './Settings'

// TeleWarden (IMPLEMENTATION.md → "Phase 19.1"): the password manager, the third built-in drive.

type ListFilter = 'all' | 'fav' | 'trash' | ItemType
type View =
  | { kind: 'list'; filter: ListFilter; folder?: string }
  | { kind: 'generator' }
  | { kind: 'codes' }
  | { kind: 'settings' }

const TYPES: ItemType[] = ['login', 'card', 'identity', 'note']
const isWebsite = !isAndroid && !isDesktop

function viewOf(pathname: string): View {
  if (pathname === '/generator') return { kind: 'generator' }
  if (pathname === '/codes') return { kind: 'codes' }
  if (pathname === '/settings') return { kind: 'settings' }
  const folder = pathname.match(/^\/v\/folder\/([^/]+)$/)
  if (folder) return { kind: 'list', filter: 'all', folder: decodeURIComponent(folder[1]) }
  const f = pathname.match(/^\/v\/(fav|trash|login|card|identity|note)$/)
  return { kind: 'list', filter: (f?.[1] as ListFilter | undefined) ?? 'all' }
}

type Modal =
  | { type: 'new'; itemType: ItemType }
  | { type: 'edit'; item: VaultItem; generate?: boolean }
  | { type: 'move'; item: VaultItem }
  | { type: 'deleteForever'; items: VaultItem[] }
  | { type: 'emptyTrash' }
  | { type: 'newFolder' }
  | { type: 'renameFolder'; id: string; name: string }
  | { type: 'deleteFolder'; id: string; name: string }
  | { type: 'logout' }
  | { type: 'getApps' }
  | { type: 'newDrive' }
  | { type: 'reminder' }
  | { type: 'addCode' }
  | { type: 'import' }
  | { type: 'importGoogle' }
  | { type: 'recover' }
  | { type: 'reset' }

function useWide() {
  const query = '(min-width: 768px)'
  const [wide, setWide] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const m = matchMedia(query)
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return wide
}

export default function VaultPage() {
  const status = useVault((s) => s.status)
  const pendingCode = useVault((s) => s.pendingCode)
  const items = useVault((s) => s.items)
  const folders = useVault((s) => s.folders)
  const damaged = useVault((s) => s.damaged)
  const lockedBecause = useVault((s) => s.lockedBecause)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const view = viewOf(pathname)
  const wide = useWide()
  const [query, setQuery] = useState('')
  const [chip, setChip] = useState<'all' | ItemType>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [sheet, setSheet] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [modal, setModal] = useState<Modal | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null)
  const open = status === 'open' && !pendingCode

  // Activity keeps it open (at most once a second)
  useEffect(() => {
    if (!open) return
    let last = 0
    const touch = () => {
      if (Date.now() - last < 1000) return
      last = Date.now()
      useVault.getState().touch()
    }
    for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, touch, { passive: true, capture: true })
    return () => {
      for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.removeEventListener(ev, touch, { capture: true })
    }
  }, [open])

  // A week after setting up, once: does the person still know the master password?
  const config = useVault((s) => s.config)
  useEffect(() => {
    if (open && reminderDue(config)) setModal({ type: 'reminder' })
  }, [open, config])

  // Screenshots blocked while TeleWarden is on screen (Android: FLAG_SECURE; Windows: content protection)
  const blockShots = useSettings((s) => s.vaultBlockScreenshots)
  useEffect(() => {
    if (!blockShots) return
    if (isAndroid) void Native.setSecure({ on: true }).catch(() => {})
    desktop?.setContentProtection?.(true)
    return () => {
      if (isAndroid) void Native.setSecure({ on: false }).catch(() => {})
      desktop?.setContentProtection?.(false)
    }
  }, [blockShots])

  useEffect(() => {
    if (!lockedBecause) return
    toast(lockedBecause)
    useVault.setState({ lockedBecause: null })
  }, [lockedBecause])

  // A new place starts with everything shown
  useEffect(() => {
    setChip('all')
    setQuery('')
    setSheet(false)
  }, [pathname])

  const filter = view.kind === 'list' ? view.filter : null
  const folder = view.kind === 'list' ? view.folder : undefined
  /** `scope`: what this place holds (for the chips); `shown`: after the chip and the search. */
  const { shown, scope } = useMemo(() => {
    if (!filter) return { shown: [], scope: [] }
    let l = items.filter((i) => (filter === 'trash' ? !!i.tr : !i.tr))
    if (folder) l = l.filter((i) => i.f === folder)
    else if (filter === 'fav') l = l.filter((i) => i.fav)
    else if (filter !== 'all' && filter !== 'trash') l = l.filter((i) => i.ty === filter)
    const scope = l
    if (chip !== 'all') l = l.filter((i) => i.ty === chip)
    if (query) l = l.filter((i) => matchesSearch(i, query))
    return { shown: [...l].sort(byName), scope }
  }, [items, filter, folder, chip, query])
  const selectedItem = items.find((i) => i.id === selected) ?? null
  const visibleSelected = selectedItem && shown.some((i) => i.id === selectedItem.id) ? selectedItem : null

  /** Just saved: select it once it shows up (the store reads it back a moment later). */
  const waitingFor = useRef<string | null>(null)
  // Wide screens: something is always shown in the detail column
  useEffect(() => {
    if (waitingFor.current) {
      if (!items.some((i) => i.id === waitingFor.current)) return
      waitingFor.current = null
    }
    if (wide && view.kind === 'list' && !visibleSelected && shown.length) setSelected(shown[0].id)
  }, [wide, view.kind, visibleSelected, shown, items])

  useBackHandler(sheet, () => setSheet(false))

  const go = (to: string) => {
    navigate(to)
    setDrawer(false)
  }
  const select = (id: string) => {
    setSelected(id)
    if (!wide) setSheet(true)
  }
  const openMenu = (e: React.MouseEvent, entries: MenuEntry[]) => {
    const r = e.currentTarget.getBoundingClientRect()
    setMenu({ x: r.right - 240, y: r.bottom + 4, entries })
  }
  const newMenu = (e: React.MouseEvent) => {
    e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    const entries: MenuEntry[] = [
      ...TYPES.map((t) => ({ label: TYPE_NAMES[t].one, icon: TYPE_ICONS[t], onClick: () => setModal({ type: 'new', itemType: t }) })),
      { label: 'Folder', icon: FolderPlus, onClick: () => setModal({ type: 'newFolder' }) },
      { label: 'Import passwords', icon: Download, onClick: () => setModal({ type: 'import' }) },
    ]
    setMenu({ x: r.left, y: r.bottom + 8, entries })
  }
  const detailActions = (item: VaultItem) => ({
    edit: () => setModal({ type: 'edit', item }),
    move: () => setModal({ type: 'move', item }),
    deleteForever: () => setModal({ type: 'deleteForever', items: [item] }),
    select: (id: string) => {
      waitingFor.current = id
      select(id)
    },
  })

  const title =
    view.kind === 'generator'
      ? 'Generator'
      : view.kind === 'codes'
        ? '2FA codes'
      : view.kind === 'settings'
        ? 'Settings'
        : view.folder
          ? (folders.find((f) => f.id === view.folder)?.n ?? 'Folder')
          : { all: 'All items', fav: 'Favorites', trash: 'Trash', login: 'Logins', card: 'Cards', identity: 'Identities', note: 'Notes' }[view.filter]
  const showChips = view.kind === 'list' && (view.filter === 'all' || view.filter === 'fav' || !!view.folder)
  const searchBox = (
    <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted" />
      <input
        type="text"
        role="searchbox"
        placeholder={`Search ${title.toLowerCase()}`}
        className="input pr-10 pl-10.5"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
      />
      {query && (
        <button className="absolute top-1/2 right-1.5 -translate-y-1/2 icon-btn-flat" onClick={() => setQuery('')} aria-label="Clear search">
          <X />
        </button>
      )}
    </div>
  )

  const sidebar = (
    <VaultSidebar
      open={open}
      onNew={newMenu}
      onNewFolder={() => setModal({ type: 'newFolder' })}
      onFolderMenu={(e, id, name) =>
        openMenu(e, [
          { label: 'Rename', icon: Pencil, onClick: () => setModal({ type: 'renameFolder', id, name }) },
          { label: 'Delete folder', icon: Trash2, danger: true, onClick: () => setModal({ type: 'deleteFolder', id, name }) },
        ])
      }
      onLogout={() => setModal({ type: 'logout' })}
      onGetApps={isWebsite ? () => setModal({ type: 'getApps' }) : undefined}
      onNewDrive={() => setModal({ type: 'newDrive' })}
      go={go}
    />
  )

  let content: React.ReactNode
  if (status === 'none' || pendingCode === 'setup') content = <VaultSetup />
  else if (status === 'locked' || pendingCode === 'recover') content = <VaultLock />
  else if (view.kind === 'generator') content = <GeneratorPanel />
  else if (view.kind === 'codes')
    content = (
      <>
        <div className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-2 md:mb-5">
          <h1 className="h-display">2FA codes</h1>
        </div>
        {!wide && <div className="mb-4 flex">{searchBox}</div>}
        <CodesPanel
          query={query}
          onAdd={() => setModal({ type: 'addCode' })}
          onImport={() => setModal({ type: 'importGoogle' })}
          onOpen={(id) => {
            go('/v/login')
            waitingFor.current = id
            select(id)
          }}
        />
      </>
    )
  else if (view.kind === 'settings') content = <SettingsView extra={<VaultSettings />} onGetApps={isWebsite ? () => setModal({ type: 'getApps' }) : undefined} />

  return (
    <div className="flex h-full md:gap-4.5 md:p-4.5">
      <aside className="panel hidden w-64 shrink-0 md:block">{sidebar}</aside>
      {drawer && (
        <div className="fixed inset-0 z-40 bg-scrim md:hidden" onClick={() => setDrawer(false)}>
          <aside className="h-full w-72 rounded-r-md bg-surface lift" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-11 items-center gap-2.5 px-4 pt-4 md:gap-3 md:px-0 md:pt-0">
          <button className="icon-btn md:hidden" onClick={() => setDrawer(true)} aria-label="Menu">
            <MenuIcon />
          </button>
          {/* Wide screens: search in the top bar; phones: under the title */}
          {open && (view.kind === 'list' || view.kind === 'codes') && wide ? searchBox : <div className="flex-1" />}
          {open && (
            <>
              <LockCountdown className="md:hidden" />
              <button className="icon-btn" onClick={() => useVault.getState().lock()} aria-label="Lock TeleWarden" title="Lock TeleWarden">
                <Lock />
              </button>
            </>
          )}
          <ThemeButton />
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-5 pb-44 md:-mx-4.5 md:-mb-4.5 md:px-4.5 md:pt-6 md:pb-8">
          {content ?? (
            <>
              <div className="mb-4 md:mb-5">
                {view.kind === 'list' && view.folder && (
                  <p className="mb-2 text-[15px] font-bold text-muted">
                    Folders <span className="text-brand-ink">/</span>
                  </p>
                )}
                <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                  <h1 className="h-display min-w-0 truncate">{title}</h1>
                  {view.kind === 'list' && <span className="pb-0.5 text-sm text-muted">{shown.length} item{shown.length === 1 ? '' : 's'}</span>}
                  {view.kind === 'list' && view.filter === 'trash' && shown.length > 0 && (
                    <button className="btn-danger-solid ml-auto" onClick={() => setModal({ type: 'emptyTrash' })}>
                      <Trash2 /> Empty trash
                    </button>
                  )}
                </div>
                {view.kind === 'list' && view.filter === 'trash' && <p className="mt-2 text-sm text-muted">Items in the trash are deleted forever after 30 days.</p>}
                {damaged > 0 && (
                  <p className="mt-2 text-sm font-semibold text-brand-ink">
                    {damaged} item{damaged === 1 ? '' : 's'} couldn’t be decrypted (damaged or changed outside TeleDrive).
                  </p>
                )}
              </div>
              {!wide && <div className="mb-3 flex">{searchBox}</div>}
              {showChips && (
                <div className="-mx-4 mb-3 flex shrink-0 gap-2.5 overflow-x-auto px-4 pt-1 pb-3 [scrollbar-width:none] md:-mx-4.5 md:px-4.5">
                  {(['all', ...TYPES] as const)
                    .filter((t) => t === 'all' || scope.some((i) => i.ty === t))
                    .map((t) => (
                      <button key={t} className={chip === t ? 'chip-active' : 'chip'} onClick={() => setChip(t)}>
                        {t === 'all' ? 'All' : TYPE_NAMES[t].many}
                      </button>
                    ))}
                </div>
              )}
              <div className="grid flex-1 grid-cols-1 items-start md:min-h-0 gap-4.5 md:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
                <section className="-mx-3 md:mx-0 md:panel md:p-2">
                  {shown.length ? (
                    shown.map((i) => <ItemRow key={i.id} item={i} selected={wide && i.id === visibleSelected?.id} onOpen={() => select(i.id)} />)
                  ) : (
                    <Empty view={view} query={query} anyItems={items.some((i) => !i.tr)} onNew={(t) => setModal({ type: 'new', itemType: t })} onImport={() => setModal({ type: 'import' })} />
                  )}
                </section>
                <section className="panel sticky top-0 hidden md:block">
                  {visibleSelected ? (
                    <ItemDetail
                      key={visibleSelected.id}
                      item={visibleSelected}
                      onEdit={() => setModal({ type: 'edit', item: visibleSelected })}
                      onMenu={(e) => openMenu(e, itemMenu(visibleSelected, detailActions(visibleSelected)))}
                      onDeleteForever={() => setModal({ type: 'deleteForever', items: [visibleSelected] })}
                    />
                  ) : (
                    <div className="m-5.5 flex flex-col items-center gap-3 rounded-md px-7 py-11 text-center pressed-lg">
                      <span className="flex size-18 items-center justify-center rounded-md text-muted raised">
                        <MousePointerClick className="size-8" />
                      </span>
                      <p className="text-muted">Pick an item to see its details</p>
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </div>
      </main>

      {open && view.kind === 'list' && (
        <button className="fixed right-6 bottom-26 z-20 flex size-15 items-center justify-center rounded-[10px] bg-brand text-white raised-md md:hidden" onClick={newMenu} aria-label="New">
          <Plus className="size-6.5" strokeWidth={2.4} />
        </button>
      )}
      {open && <BottomNav pathname={pathname} go={go} />}

      {sheet && visibleSelected && !wide && (
        <div className="fixed inset-0 z-40 flex items-end bg-scrim md:hidden" onClick={() => setSheet(false)}>
          <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_rgba(0,0,0,0.18)]" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mt-2.5 h-1.25 w-10 rounded-full pressed-xs" aria-hidden />
            <ItemDetail
              item={visibleSelected}
              onEdit={() => setModal({ type: 'edit', item: visibleSelected })}
              onMenu={(e) => openMenu(e, itemMenu(visibleSelected, detailActions(visibleSelected)))}
              onDeleteForever={() => setModal({ type: 'deleteForever', items: [visibleSelected] })}
            />
          </div>
        </div>
      )}

      {menu && <Menu {...menu} onClose={() => setMenu(null)} />}
      {modal?.type === 'new' && (
        <ItemForm type={modal.itemType} folder={view.kind === 'list' ? view.folder : undefined} onClose={() => setModal(null)} onSaved={(i) => ((waitingFor.current = i.id), setSelected(i.id))} />
      )}
      {modal?.type === 'edit' && <ItemForm type={modal.item.ty} item={modal.item} generate={modal.generate} onClose={() => setModal(null)} />}
      {modal?.type === 'move' && <MoveDialog item={modal.item} onClose={() => setModal(null)} />}
      {modal?.type === 'deleteForever' && (
        <ConfirmDialog
          title="Delete forever?"
          message={`“${modal.items[0].n}” will be deleted from all your devices. This can’t be undone.`}
          confirmLabel="Delete forever"
          danger
          icon={Trash2}
          onConfirm={async () => {
            await useVault.getState().deleteForever(modal.items.map((i) => i.id))
            setSheet(false)
            toast(`Deleted “${modal.items[0].n}”`)
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'emptyTrash' && (
        <ConfirmDialog
          title="Empty trash?"
          message={`${shown.length} item${shown.length === 1 ? '' : 's'} will be deleted from all your devices. This can’t be undone.`}
          confirmLabel="Empty trash"
          danger
          icon={Trash2}
          onConfirm={async () => {
            await useVault.getState().emptyTrash()
            toast('Trash emptied')
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'newFolder' && (
        <PromptDialog
          title="New folder"
          confirmLabel="Create"
          onSubmit={async (name) => {
            const id = newVaultId()
            await useVault.getState().saveFolder({ id, n: name, rd: Date.now() })
            go(`/v/folder/${id}`)
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'renameFolder' && (
        <PromptDialog
          title="Rename folder"
          initial={modal.name}
          confirmLabel="Rename"
          onSubmit={(name) => useVault.getState().saveFolder({ id: modal.id, n: name, rd: Date.now() })}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'deleteFolder' && (
        <ConfirmDialog
          title="Delete folder?"
          message={`“${modal.name}” is deleted. The items in it stay in TeleWarden, in no folder.`}
          confirmLabel="Delete folder"
          danger
          icon={Trash2}
          onConfirm={async () => {
            await useVault.getState().deleteFolder(modal.id)
            if (view.kind === 'list' && view.folder === modal.id) go('/')
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'logout' && (
        <ConfirmDialog
          title="Log out?"
          confirmLabel="Log out"
          message="Your files and passwords stay safe in Telegram. You can log in again any time."
          onConfirm={() => useDrive.getState().logout()}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'addCode' && <AddCodeDialog onClose={() => setModal(null)} />}
      {modal?.type === 'import' && <ImportDialog onClose={() => setModal(null)} />}
      {modal?.type === 'importGoogle' && <ImportGoogleDialog onClose={() => setModal(null)} />}
      {modal?.type === 'reminder' && config && (
        <ReminderDialog ct={config.ct} onClose={() => setModal(null)} onRecover={() => setModal({ type: 'recover' })} />
      )}
      {modal?.type === 'recover' && <RecoverDialog onClose={() => setModal(null)} onReset={() => setModal({ type: 'reset' })} />}
      {modal?.type === 'reset' && <ResetDialog onClose={() => setModal(null)} />}
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
      <Toasts />
    </div>
  )
}

function Empty(props: { view: View; query: string; anyItems: boolean; onNew: (t: ItemType) => void; onImport: () => void }) {
  const { view, query, anyItems, onNew, onImport } = props
  const wrap = (icon: LucideIcon, title: string, text: string, actions?: React.ReactNode) => {
    const Icon = icon
    return (
      <div className="m-2 flex flex-col items-center gap-3 rounded-md px-7 py-11 text-center pressed-lg">
        <span className="flex size-18 items-center justify-center rounded-md text-muted raised">
          <Icon className="size-8" />
        </span>
        <p className="text-[22px] font-black tracking-[-0.02em]">{title}</p>
        <p className="max-w-[34ch] text-muted">{text}</p>
        {actions && <div className="mt-1.5 flex flex-wrap justify-center gap-3">{actions}</div>}
      </div>
    )
  }
  if (query) return wrap(Search, 'No matches', `Nothing here matches “${query}”.`)
  if (view.kind === 'list' && view.filter === 'trash') return wrap(Trash2, 'Trash is empty', 'Deleted items stay here for 30 days.')
  if (!anyItems)
    return wrap(
      KeyRound,
      'Your vault is empty',
      'Add your first login, or bring your passwords over from Bitwarden, Chrome or another manager.',
      <>
        <button className="btn-primary" onClick={() => onNew('login')}>
          <Plus /> New login
        </button>
        <button className="btn-secondary" onClick={onImport}>
          <Download /> Import passwords
        </button>
      </>,
    )
  const t = view.kind === 'list' && view.filter !== 'all' && view.filter !== 'fav' ? (view.filter as ItemType) : 'login'
  return wrap(
    view.kind === 'list' && view.filter === 'fav' ? Star : TYPE_ICONS[t],
    'Nothing here yet',
    view.kind === 'list' && view.filter === 'fav' ? 'Star an item to find it here quickly.' : 'Items you add here show up on all your devices.',
    view.kind === 'list' && view.filter === 'fav' ? undefined : (
      <button className="btn-primary" onClick={() => onNew(t)}>
        <Plus /> New {TYPE_NAMES[t].one.toLowerCase()}
      </button>
    ),
  )
}

function MoveDialog({ item, onClose }: { item: VaultItem; onClose: () => void }) {
  const folders = useVault((s) => s.folders)
  const move = async (f: string | undefined) => {
    try {
      await useVault.getState().save({ ...item, f })
      toast(f ? `Moved to ${folders.find((x) => x.id === f)?.n}` : 'Removed from its folder')
      onClose()
    } catch (e) {
      toastError(e)
    }
  }
  return (
    <Dialog title="Move to folder" subtitle={item.n} icon={Folder} onClose={onClose}>
      <div className="space-y-2.5 pb-1">
        {[{ id: '', n: 'No folder' }, ...[...folders].sort(byName)].map((f) => (
          <Choice key={f.id} name="folder" label={f.n} checked={(item.f ?? '') === f.id} onChange={() => void move(f.id || undefined)} />
        ))}
        {!folders.length && <p className="text-sm text-muted">No folders yet. Make one with + New → Folder.</p>}
      </div>
    </Dialog>
  )
}

/** "Open · locks in 4:12" (or "Open" when it only locks on close). */
function LockCountdown({ className = '' }: { className?: string }) {
  const lastActive = useVault((s) => s.lastActive)
  const minutes = useSettings((s) => s.vaultLockMinutes)
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const left = minutes ? Math.max(0, Math.ceil((lastActive + minutes * 60_000 - Date.now()) / 1000)) : null
  return (
    <span className={`rounded-md bg-brand px-2 py-1 text-[11px] font-extrabold tracking-[0.08em] text-white uppercase tabular-nums ${className}`} title="TeleWarden locks itself after this long without activity">
      Open{left !== null && ` · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}
    </span>
  )
}

function VaultSidebar(props: {
  open: boolean
  onNew: (e: React.MouseEvent) => void
  onNewFolder: () => void
  onFolderMenu: (e: React.MouseEvent, id: string, name: string) => void
  onLogout: () => void
  onGetApps?: () => void
  onNewDrive: () => void
  go: (to: string) => void
}) {
  const { open, onNew, onNewFolder, onFolderMenu, onLogout, onGetApps, onNewDrive, go } = props
  const items = useVault((s) => s.items)
  const folders = useVault((s) => s.folders)
  const navigate = useNavigate()
  const live = items.filter((i) => !i.tr)
  const count = (t?: ItemType) => (t ? live.filter((i) => i.ty === t).length : live.length)

  const switchDrive = (id: string) => {
    navigate('/')
    useDrive.getState().switchDrive(id).catch(toastError)
  }
  const link = (to: string, icon: LucideIcon, label: string, n?: number) => {
    const Icon = icon
    return (
      <NavLink
        key={to}
        to={to}
        end
        onClick={(e) => {
          e.preventDefault()
          if (open) go(to)
        }}
        aria-disabled={!open}
        className={({ isActive }) =>
          `flex h-10.5 w-full items-center gap-3 rounded-md px-3.5 text-sm transition-[box-shadow,color] duration-120 [&_svg]:size-[19px] [&_svg]:shrink-0 ${
            !open ? 'pointer-events-none opacity-45' : ''
          } ${isActive && open ? 'font-extrabold text-brand-ink pressed' : 'font-semibold text-muted hover:text-ink active:pressed'}`
        }
      >
        <Icon /> <span className="truncate">{label}</span>
        {!!n && <span className="ml-auto text-xs font-semibold text-muted">{n}</span>}
      </NavLink>
    )
  }

  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto px-3.5 py-5">
      <DrivePicker
        onSwitchDrive={switchDrive}
        onOpenPhotos={() => (navigate('/'), useDrive.getState().openPhotos().catch(toastError))}
        onOpenVault={() => {}}
        onNewDrive={onNewDrive}
      />
      <div className="mb-4 px-1">
        <button className="btn-primary w-full" onClick={onNew} disabled={!open} aria-haspopup="menu">
          <Plus strokeWidth={2.4} /> New
        </button>
      </div>
      <nav className="space-y-1">
        {link('/', LayoutGrid, 'All items', count())}
        {link('/v/fav', Star, 'Favorites', live.filter((i) => i.fav).length)}
        {TYPES.map((t) => link(`/v/${t}`, TYPE_ICONS[t], TYPE_NAMES[t].many, count(t)))}
      </nav>
      <div className="flex items-center justify-between px-3.5 pt-4 pb-1">
        <span className="text-[11px] font-extrabold tracking-[0.1em] text-muted uppercase">Folders</span>
        <button className="text-muted hover:text-brand-ink disabled:opacity-45" onClick={onNewFolder} disabled={!open} aria-label="New folder" title="New folder">
          <FolderPlus className="size-4" />
        </button>
      </div>
      <nav className="space-y-1">
        {open && !folders.length && <p className="px-3.5 text-xs text-muted">No folders yet</p>}
        {[...folders].sort(byName).map((f) => (
          <div key={f.id} className="group relative" onContextMenu={(e) => (e.preventDefault(), onFolderMenu(e, f.id, f.n))}>
            {link(`/v/folder/${f.id}`, Folder, f.n, live.filter((i) => i.f === f.id).length)}
          </div>
        ))}
      </nav>
      <div className="flex items-center px-3.5 pt-4 pb-1">
        <span className="text-[11px] font-extrabold tracking-[0.1em] text-muted uppercase">Tools</span>
      </div>
      <nav className="space-y-1">
        {link('/codes', ScanQrCode, '2FA codes', live.filter((i) => i.ty === 'login' && i.d.otp).length)}
        {link('/generator', Dices, 'Generator')}
        {link('/v/trash', Trash2, 'Trash', items.filter((i) => i.tr).length)}
      </nav>

      <div className="mt-auto space-y-2 pt-6">
        <div className="rounded-md p-3.5 pressed">
          {open ? (
            <>
              <p className="flex items-baseline gap-1.5">
                <span className="text-xl leading-none font-black tracking-[-0.02em] tabular-nums">{live.length}</span>
                <span className="text-xs text-muted">item{live.length === 1 ? '' : 's'}</span>
              </p>
              <p className="mt-1.5 text-xs text-muted">
                {TYPES.filter((t) => count(t)).map((t) => `${count(t)} ${count(t) === 1 ? TYPE_NAMES[t].one.toLowerCase() : TYPE_NAMES[t].many.toLowerCase()}`).join(' · ') || 'Empty'}
              </p>
              <div className="mt-3 border-t-2 border-line pt-2">
                <div className="flex h-8 items-center gap-2 px-1 text-xs">
                  <LockOpen className="size-3.5 text-brand-ink" />
                  <span className="font-semibold">Open</span>
                  <span className="ml-auto"><LockCountdown /></span>
                </div>
                <button className="btn-secondary mt-1.5 h-10 w-full" onClick={() => useVault.getState().lock()}>
                  <Lock /> Lock now
                </button>
              </div>
            </>
          ) : (
            <p className="flex items-center gap-2 text-sm font-bold">
              <Lock className="size-4 text-brand-ink" /> Locked
            </p>
          )}
        </div>
        {link('/settings', Settings, 'Settings')}
        {onGetApps && (
          <button className="flex h-10.5 w-full items-center gap-3 rounded-md px-3.5 text-sm font-semibold text-muted hover:text-ink [&_svg]:size-[19px]" onClick={onGetApps}>
            <MonitorSmartphone /> Get the app
          </button>
        )}
        <button className="flex h-10.5 w-full items-center gap-3 rounded-md px-3.5 text-sm font-semibold text-muted hover:text-ink [&_svg]:size-[19px]" onClick={onLogout}>
          <LogOut /> Log out
        </button>
      </div>
    </div>
  )
}

function BottomNav({ pathname, go }: { pathname: string; go: (to: string) => void }) {
  const tabs = [
    { label: 'Vault', icon: KeyRound, to: '/', on: pathname === '/' || pathname.startsWith('/v/') },
    { label: '2FA codes', icon: ScanQrCode, to: '/codes', on: pathname === '/codes' },
    { label: 'Generator', icon: Dices, to: '/generator', on: pathname === '/generator' },
    { label: 'Settings', icon: Settings, to: '/settings', on: pathname === '/settings' },
  ]
  return (
    <nav className="fixed inset-x-3 bottom-3 z-20 flex h-18 items-center justify-around rounded-md bg-surface raised-md md:hidden">
      {tabs.map((t) => (
        <button
          key={t.label}
          onClick={() => go(t.to)}
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
