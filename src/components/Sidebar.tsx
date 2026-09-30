import {
  Camera, Check, ChevronDown, Clock, FolderPlus, Plus, FolderUp, HardDrive, Lock, LockOpen, LogOut, Send, ShieldCheck, Star, Trash2, Upload, type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { driveName } from '../telegram/channel'
import { driveStats } from '../drive/tree'
import { formatBytes } from '../lib/format'
import { useDrive, useRootName } from '../store/useDrive'

export default function Sidebar(props: {
  onUpload: () => void
  /** Not in the Android app (its file picker can't pick folders). */
  onUploadFolder?: () => void
  onNewFolder: () => void
  onLogout: () => void
  onEncryption: () => void
  onSwitchDrive: (id: string) => void
  onNewDrive: () => void
  /** Only in the Android app. */
  onCameraBackup?: () => void
}) {
  const { onUpload, onUploadFolder, onNewFolder, onLogout, onEncryption, onSwitchDrive, onNewDrive, onCameraBackup } = props
  const drives = useDrive((s) => s.drives)
  const currentDrive = useDrive((s) => s.currentDrive)
  const [picking, setPicking] = useState(false)
  const current = drives.find((d) => d.id === currentDrive)
  const rootName = useRootName()
  const drive = useDrive((s) => s.drive)
  const unlocked = useDrive((s) => s.unlocked)
  const EncIcon = !drive.encryption ? ShieldCheck : unlocked ? LockOpen : Lock
  const { pathname } = useLocation()
  const stats = driveStats(drive)
  const inDrive = pathname === '/' || pathname.startsWith('/folder/')

  return (
    <div className="flex h-full flex-col gap-1 p-4">
      <button
        className="mb-1 flex items-center gap-2.5 rounded-xl px-2 py-1 text-left hover:bg-slate-200/70 dark:hover:bg-slate-800"
        // Doesn't close the phone drawer: it only opens the list
        onClick={(e) => {
          e.stopPropagation()
          setPicking(!picking)
        }}
        aria-expanded={picking}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand text-white">
          <Send className="h-5 w-5" />
        </div>
        <span className="min-w-0 flex-1">
          <span className="block text-lg leading-tight font-semibold">TeleDrive</span>
          <span className="block truncate text-xs text-slate-500">{current ? driveName(current) : ' '}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${picking ? 'rotate-180' : ''}`} />
      </button>
      {picking && (
        <div className="mb-2 space-y-0.5 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/60">
          {drives.map((d) => (
            <button
              key={d.id}
              className="btn w-full justify-start py-1.5 text-slate-700 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-700"
              onClick={() => {
                setPicking(false)
                onSwitchDrive(d.id)
              }}
            >
              <HardDrive className="h-4 w-4" />
              <span className="truncate">{driveName(d)}</span>
              {d.id === currentDrive && <Check className="ml-auto h-4 w-4 text-brand" />}
            </button>
          ))}
          <button
            className="btn w-full justify-start py-1.5 text-slate-700 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-700"
            onClick={() => {
              setPicking(false)
              onNewDrive()
            }}
          >
            <Plus className="h-4 w-4" /> New drive
          </button>
        </div>
      )}
      <div className="mb-4" />

      <button className="btn-primary mb-1 justify-start py-2.5" onClick={onUpload}>
        <Upload className="h-4 w-4" /> Upload files
      </button>
      {onUploadFolder && (
        <button className="btn-ghost mb-1 justify-start py-2.5" onClick={onUploadFolder}>
          <FolderUp className="h-4 w-4" /> Upload folder
        </button>
      )}
      <button className="btn-ghost mb-4 justify-start py-2.5" onClick={onNewFolder}>
        <FolderPlus className="h-4 w-4" /> New folder
      </button>

      <nav className="space-y-0.5">
        <Link to="/" icon={HardDrive} label={rootName} active={inDrive} />
        <Link to="/recent" icon={Clock} label="Recent" />
        <Link to="/starred" icon={Star} label="Starred" />
        <Link to="/trash" icon={Trash2} label="Trash" />
        {onCameraBackup && (
          <button
            className="btn w-full justify-start text-slate-700 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
            onClick={onCameraBackup}
          >
            <Camera className="h-4 w-4" /> Camera backup
          </button>
        )}
        <button
          className="btn w-full justify-start text-slate-700 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
          onClick={onEncryption}
        >
          <EncIcon className="h-4 w-4" /> Encryption
          <span className="ml-auto text-xs text-slate-400">{!drive.encryption ? 'Off' : unlocked ? 'Unlocked' : 'Locked'}</span>
        </button>
      </nav>

      <div className="mt-auto space-y-3">
        <div className="rounded-xl bg-slate-100 p-3 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-400">
          <p className="font-medium text-slate-900 dark:text-slate-100">{formatBytes(stats.bytes)} used</p>
          <p>
            {stats.files} file{stats.files === 1 ? '' : 's'} · {stats.folders} folder{stats.folders === 1 ? '' : 's'}
          </p>
          <p className="mt-1 text-slate-400">Unlimited storage on Telegram</p>
        </div>
        <button className="btn-ghost w-full justify-start" onClick={onLogout}>
          <LogOut className="h-4 w-4" /> Log out
        </button>
      </div>
    </div>
  )
}

function Link({ to, icon: Icon, label, active }: { to: string; icon: LucideIcon; label: string; active?: boolean }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `btn w-full justify-start ${
          (active ?? isActive)
            ? 'bg-brand/10 text-brand-dark dark:text-brand'
            : 'text-slate-700 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
        }`
      }
    >
      <Icon className="h-4 w-4" /> {label}
    </NavLink>
  )
}
