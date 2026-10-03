import {
  Album, Camera, Check, ChevronDown, Clock, FolderPlus, FolderUp, HardDrive, Images, Lock, LockOpen, LogOut, MonitorSmartphone, Plus, Settings, Star,
  Trash2, Upload, type LucideIcon,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { driveName, isPhotosDrive, PHOTOS_NAME } from '../telegram/channel'
import { APP_VERSION } from '../lib/releases'
import { updateNow, useUpdate, type UpdateStatus } from '../lib/updates'
import { isAndroid } from '../native/android'
import { isDesktop } from '../native/desktop'

import { collectTree, driveStats, isHidden, starredItems, trashedItems, type Drive } from '../drive/tree'
import { category, formatBytes } from '../lib/format'
import { useBackup } from '../native/backup'
import { useDrive, useInPhotos, useRootName } from '../store/useDrive'
import Logo from './Logo'
import Menu, { type MenuEntry } from './Menu'

export default function Sidebar(props: {
  onUpload: () => void
  /** Not in the Android app (its file picker can't pick folders). */
  onUploadFolder?: () => void
  onNewFolder: () => void
  onLogout: () => void
  /** Shown while some locked items are unlocked. */
  onLockAll?: () => void
  onSwitchDrive: (id: string) => void
  /** Open TelePhotos (created the first time). */
  onOpenPhotos: () => void
  onNewDrive: () => void
  /** Only in the Android app, in TelePhotos: the storage card's Backup line (leads to Settings). */
  onCameraBackup?: () => void
  /** Only on the website: download links for the apps. */
  onGetApps?: () => void
}) {
  const { onUpload, onUploadFolder, onNewFolder, onLogout, onLockAll, onSwitchDrive, onOpenPhotos, onNewDrive, onCameraBackup, onGetApps } = props
  const drives = useDrive((s) => s.drives)
  const currentDrive = useDrive((s) => s.currentDrive)
  const [picking, setPicking] = useState(false)
  const [newMenu, setNewMenu] = useState<{ x: number; y: number } | null>(null)
  const isApp = isAndroid || isDesktop
  const current = drives.find((d) => d.id === currentDrive)
  const rootName = useRootName()
  const drive = useDrive((s) => s.drive)
  const { pathname } = useLocation()
  const counts = useMemo(() => ({ starred: starredItems(drive).length, trash: trashedItems(drive).length }), [drive])
  const inDrive = pathname === '/' || pathname.startsWith('/folder/')
  const inPhotos = useInPhotos()
  // TelePhotos is listed even before its channel exists (it's created when first opened)
  const hasPhotos = drives.some(isPhotosDrive)

  const newEntries: MenuEntry[] = inPhotos
    ? [{ label: 'Upload photos', icon: Upload, onClick: onUpload }]
    : [
        { label: 'Upload files', icon: Upload, onClick: onUpload },
        ...(onUploadFolder ? [{ label: 'Upload folder', icon: FolderUp, onClick: onUploadFolder }] : []),
        { label: 'New folder', icon: FolderPlus, onClick: onNewFolder },
      ]
  const pickerRow = (key: string, Icon: LucideIcon, name: string, on: boolean, onClick: () => void) => (
    <button
      key={key}
      className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm font-semibold active:pressed"
      onClick={() => {
        setPicking(false)
        onClick()
      }}
    >
      <Icon className="size-4 shrink-0 text-muted" />
      <span className="truncate">{name}</span>
      {on && <Check className="ml-auto size-4 shrink-0 text-brand-ink" strokeWidth={2.5} />}
    </button>
  )

  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto px-3.5 py-5">
      <button
        className="mb-4 flex items-center gap-3 rounded-md px-1.5 py-1 text-left active:pressed"
        // Doesn't close the phone drawer: it only opens the list
        onClick={(e) => {
          e.stopPropagation()
          setPicking(!picking)
        }}
        aria-expanded={picking}
      >
        <Logo />
        <span className="min-w-0 flex-1">
          <span className="block text-lg leading-tight font-black tracking-tight">TeleDrive</span>
          <span className="block truncate text-xs text-muted">{current ? driveName(current) : ' '}</span>
        </span>
        <ChevronDown className={`size-4 shrink-0 text-muted transition-transform ${picking ? 'rotate-180' : ''}`} />
      </button>
      {picking && (
        <div className="mb-4 space-y-1 rounded-md p-1.5 pressed">
          {drives.flatMap((d, i) => [
            pickerRow(d.id, isPhotosDrive(d) ? Images : HardDrive, driveName(d), d.id === currentDrive, () =>
              isPhotosDrive(d) ? onOpenPhotos() : onSwitchDrive(d.id),
            ),
            // Not created yet: right after My Drive
            ...(i === 0 && !hasPhotos ? [pickerRow('photos', Images, PHOTOS_NAME, false, onOpenPhotos)] : []),
          ])}
          <button
            className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm font-semibold text-muted active:pressed"
            onClick={() => {
              setPicking(false)
              onNewDrive()
            }}
          >
            <Plus className="size-4" /> New drive
          </button>
        </div>
      )}

      <div className="mb-4 px-1">
        <button
          className="btn-primary"
          onClick={(e) => {
            // Not closing the phone drawer: the menu opens over it
            e.stopPropagation()
            const r = e.currentTarget.getBoundingClientRect()
            setNewMenu({ x: r.left, y: r.bottom + 8 })
          }}
          aria-haspopup="menu"
        >
          <Plus strokeWidth={2.4} /> New
        </button>
      </div>

      <nav className="space-y-1">
        <Link to="/" icon={inPhotos ? Images : HardDrive} label={rootName} active={inDrive} />
        {inPhotos && <Link to="/albums" icon={Album} label="Albums" active={pathname === '/albums' || pathname.startsWith('/album/')} />}
        <Link to="/recent" icon={Clock} label="Recent" />
        <Link to="/starred" icon={Star} label="Starred" count={counts.starred} />
        <Link to="/trash" icon={Trash2} label="Trash" count={counts.trash} />
      </nav>

      <div className="mt-auto space-y-2 pt-6">
        <StorageCard drive={drive} onCameraBackup={onCameraBackup} onLockAll={onLockAll} />
        <Link to="/settings" icon={Settings} label="Settings" />
        {onGetApps && !isApp && <Item icon={MonitorSmartphone} label="Get the app" onClick={onGetApps} />}
        <Item icon={LogOut} label="Log out" onClick={onLogout} />
        {isApp && <AppVersion />}
      </div>


      {newMenu && <Menu {...newMenu} entries={newEntries} onClose={() => setNewMenu(null)} />}
    </div>
  )
}

/** The app's version and its update state (Windows and Android apps). */
function AppVersion() {
  const { status, version, progress, error } = useUpdate()
  const button = 'font-bold text-brand-ink hover:underline'
  const action: Record<UpdateStatus, React.ReactNode> = {
    none: null,
    available: (
      <button className={button} onClick={() => void updateNow()}>
        Update to {version}
      </button>
    ),
    downloading: <span>Downloading {version}{progress >= 0 ? ` · ${progress}%` : '…'}</span>,
    ready: (
      <button className={button} onClick={() => void updateNow()} title={isDesktop ? 'Installs now; otherwise when you close TeleDrive' : undefined}>
        {isDesktop ? `Restart to update to ${version}` : `Install ${version}`}
      </button>
    ),
    needsPermission: (
      <button className={button} onClick={() => void updateNow()} title="Allow TeleDrive to install updates in the settings that opened, then come back">
        Allow installing, then tap here
      </button>
    ),
    error: (
      <button className={button} onClick={() => void updateNow()} title={error ?? undefined}>
        Update failed · Try again
      </button>
    ),
  }
  return (
    <p className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 px-3.5 pt-1 text-[11px] text-muted">
      <span>Version {APP_VERSION}</span>
      {action[status]}
    </p>
  )
}

const ITEM = 'flex h-10.5 w-full items-center gap-3 rounded-md px-3.5 text-sm transition-[box-shadow,color] duration-120 [&_svg]:size-[19px] [&_svg]:shrink-0'
const IDLE = 'font-semibold text-muted hover:text-ink active:pressed'
const ACTIVE = 'font-extrabold text-brand-ink pressed'

function Link({ to, icon: Icon, label, active, count }: { to: string; icon: LucideIcon; label: string; active?: boolean; count?: number }) {
  return (
    <NavLink to={to} className={({ isActive }) => `${ITEM} ${(active ?? isActive) ? ACTIVE : IDLE}`}>
      <Icon /> <span className="truncate">{label}</span>
      {!!count && <span className="ml-auto text-xs font-semibold text-muted">{count}</span>}
    </NavLink>
  )
}

function Item({ icon: Icon, label, onClick, hint }: { icon: LucideIcon; label: string; onClick: () => void; hint?: string }) {
  return (
    <button className={`${ITEM} ${IDLE}`} onClick={onClick}>
      <Icon /> <span className="truncate">{label}</span>
      {hint && <span className="ml-auto text-xs font-medium">{hint}</span>}
    </button>
  )
}

const KINDS = [
  { key: 'photos', label: 'Photos', color: 'bg-ink' },
  { key: 'videos', label: 'Videos', color: 'bg-brand' },
  { key: 'documents', label: 'Docs', color: 'bg-muted' },
  { key: 'other', label: 'Other', color: 'bg-ink/25' },
] as const
type Kind = (typeof KINDS)[number]['key']
const KIND_OF: Partial<Record<string, Kind>> = { image: 'photos', video: 'videos', document: 'documents' }

/** Space used, how many files, and what takes the space; then trash, camera backup and locked items. */
function StorageCard(props: { drive: Drive; onCameraBackup?: () => void; onLockAll?: () => void }) {
  const { drive, onCameraBackup, onLockAll } = props
  const navigate = useNavigate()
  const backup = useBackup()
  const { stats, byKind, trash, locks } = useMemo(() => {
    const byKind: Record<Kind, number> = { photos: 0, videos: 0, documents: 0, other: 0 }
    const locks = { locked: 0, open: 0 }
    for (const i of drive.items.values()) {
      if (i.concealed) continue
      if (i.kind === 'file') byKind[KIND_OF[category(i)] ?? 'other'] += i.size
      if (i.lock && !isHidden(drive, i)) locks[i.locked ? 'locked' : 'open']++
    }
    // Everything in the trash, including what's inside trashed folders
    const trashed = trashedItems(drive)
    const bytes = trashed.reduce(
      (n, t) => n + collectTree(drive, t.id).reduce((m, i) => m + (i.kind === 'file' && !i.concealed ? i.size : 0), 0),
      0,
    )
    return { stats: driveStats(drive), byKind, trash: { items: trashed.length, bytes }, locks }
  }, [drive])
  const used = KINDS.filter((k) => byKind[k.key] > 0)
  const backupProblem = /^(Error|Needs|Paused|Some)/.test(backup.status)

  return (
    <div className="rounded-md p-3.5 pressed">
      <p className="flex items-baseline gap-1.5">
        <span className="text-xl leading-none font-black tracking-[-0.02em]">{formatBytes(stats.bytes)}</span>
        <span className="text-xs text-muted">used</span>
      </p>
      <p className="mt-1.5 text-xs text-muted">
        {stats.files} file{stats.files === 1 ? '' : 's'} · {stats.folders} folder{stats.folders === 1 ? '' : 's'}
      </p>
      {stats.bytes > 0 && (
        <>
          <div className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-md" role="img" aria-label="Space used by type">
            {used.map((k) => (
              <span key={k.key} className={k.color} style={{ flexGrow: byKind[k.key], minWidth: 3 }} />
            ))}
          </div>
          <ul className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            {used.map((k) => (
              <li key={k.key} className="flex min-w-0 items-center gap-1.5">
                <span className={`size-2 shrink-0 rounded-[2px] ${k.color}`} />
                <span className="font-semibold">{k.label}</span>
                <span className="ml-auto truncate text-muted">{formatBytes(byKind[k.key])}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-3 border-t-2 border-line pt-1.5">
        <Stat
          icon={Trash2}
          label="Trash"
          value={trash.items ? `${trash.items} item${trash.items === 1 ? '' : 's'} · ${formatBytes(trash.bytes)}` : 'Empty'}
          onClick={() => navigate('/trash')}
        />
        {onCameraBackup && (
          <Stat
            icon={Camera}
            label="Backup"
            value={backup.settings.enabled ? shortStatus(backup.status) : 'Off'}
            title={backup.settings.enabled ? backup.status : undefined}
            alert={backupProblem}
            onClick={onCameraBackup}
          />
        )}
        <Stat
          icon={locks.open ? LockOpen : Lock}
          label="Locked"
          value={locks.open ? `${locks.open} open · Lock all` : locks.locked ? `${locks.locked} item${locks.locked === 1 ? '' : 's'}` : 'None'}
          alert={locks.open > 0}
          onClick={locks.open ? onLockAll : undefined}
        />
      </div>
    </div>
  )
}

/** Camera backup's status, short enough for the card (the full text is the tooltip). */
function shortStatus(status: string): string {
  if (status.startsWith('Needs permission')) return 'Needs permission'
  if (status.startsWith('Paused')) return 'Paused'
  if (status.includes('TeleDrive password')) return 'Needs password'
  if (status.startsWith('Error')) return 'Error'
  if (status.startsWith('Some items failed')) return 'Some failed'
  return status.replace('Waiting for ', 'Waiting: ')
}

/** One line under the storage bar; a button when it leads somewhere. */
function Stat(props: { icon: LucideIcon; label: string; value: string; title?: string; alert?: boolean; onClick?: () => void }) {
  const { icon: Icon, label, value, title = value, alert, onClick } = props
  const body = (
    <>
      <Icon className={`size-3.5 shrink-0 ${alert ? 'text-brand-ink' : 'text-muted'}`} strokeWidth={2} />
      <span className="font-semibold">{label}</span>
      <span className={`ml-auto min-w-0 truncate ${alert ? 'font-bold text-brand-ink' : 'text-muted'}`} title={title}>
        {value}
      </span>
    </>
  )
  const cls = 'flex h-8 w-full items-center gap-2 rounded-md px-1 text-left text-xs'
  return onClick ? (
    <button className={`${cls} transition-[box-shadow] duration-120 hover:bg-surface hover:raised-xs`} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}
