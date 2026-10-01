import {
  Camera, Check, ChevronDown, Clock, Download, FolderPlus, FolderUp, HardDrive, Lock, LogOut, Plus, ShieldCheck, Star,
  Trash2, Upload, type LucideIcon,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { driveName } from '../telegram/channel'
import { installApp, useInstall } from '../lib/install'
import { driveStats, starredItems, trashedItems } from '../drive/tree'
import { formatBytes } from '../lib/format'
import { useDrive, useRootName } from '../store/useDrive'
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
  onNewDrive: () => void
  /** Only in the Android app. */
  onCameraBackup?: () => void
}) {
  const { onUpload, onUploadFolder, onNewFolder, onLogout, onLockAll, onSwitchDrive, onNewDrive, onCameraBackup } = props
  const drives = useDrive((s) => s.drives)
  const currentDrive = useDrive((s) => s.currentDrive)
  const [picking, setPicking] = useState(false)
  const [newMenu, setNewMenu] = useState<{ x: number; y: number } | null>(null)
  const current = drives.find((d) => d.id === currentDrive)
  const rootName = useRootName()
  const canInstall = useInstall((s) => !!s.event)
  const drive = useDrive((s) => s.drive)
  const { pathname } = useLocation()
  const stats = driveStats(drive)
  const counts = useMemo(() => ({ starred: starredItems(drive).length, trash: trashedItems(drive).length }), [drive])
  const inDrive = pathname === '/' || pathname.startsWith('/folder/')

  const newEntries: MenuEntry[] = [
    { label: 'Upload files', icon: Upload, onClick: onUpload },
    ...(onUploadFolder ? [{ label: 'Upload folder', icon: FolderUp, onClick: onUploadFolder }] : []),
    { label: 'New folder', icon: FolderPlus, onClick: onNewFolder },
  ]

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
          {drives.map((d) => (
            <button
              key={d.id}
              className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm font-semibold active:pressed"
              onClick={() => {
                setPicking(false)
                onSwitchDrive(d.id)
              }}
            >
              <HardDrive className="size-4 shrink-0 text-muted" />
              <span className="truncate">{driveName(d)}</span>
              {d.id === currentDrive && <Check className="ml-auto size-4 shrink-0 text-brand-ink" strokeWidth={2.5} />}
            </button>
          ))}
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
        <Link to="/" icon={HardDrive} label={rootName} active={inDrive} />
        <Link to="/recent" icon={Clock} label="Recent" />
        <Link to="/starred" icon={Star} label="Starred" count={counts.starred} />
        {onCameraBackup && <Item icon={Camera} label="Camera backup" onClick={onCameraBackup} />}
        <Link to="/trash" icon={Trash2} label="Trash" count={counts.trash} />
        {onLockAll && <Item icon={Lock} label="Lock all" onClick={onLockAll} hint="Unlocked items" />}
      </nav>

      <div className="mt-auto space-y-2 pt-6">
        <div className="rounded-md p-3.5 pressed">
          <p className="flex items-center gap-2 text-[13px] font-extrabold">
            <ShieldCheck className="size-4 text-brand-ink" strokeWidth={2} /> Encrypted
          </p>
          <p className="mt-1 text-xs text-muted">
            {formatBytes(stats.bytes)} used · {stats.files} file{stats.files === 1 ? '' : 's'} · no limit
          </p>
        </div>
        {canInstall && <Item icon={Download} label="Install app" onClick={() => void installApp()} />}
        <Item icon={LogOut} label="Log out" onClick={onLogout} />
      </div>

      {newMenu && <Menu {...newMenu} entries={newEntries} onClose={() => setNewMenu(null)} />}
    </div>
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
