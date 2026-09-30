import { Clock, FolderPlus, HardDrive, LogOut, Send, Star, Trash2, Upload, type LucideIcon } from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import { driveStats } from '../drive/tree'
import { formatBytes } from '../lib/format'
import { useDrive } from '../store/useDrive'

export default function Sidebar(props: { onUpload: () => void; onNewFolder: () => void; onLogout: () => void }) {
  const { onUpload, onNewFolder, onLogout } = props
  const drive = useDrive((s) => s.drive)
  const { pathname } = useLocation()
  const stats = driveStats(drive)
  const inDrive = pathname === '/' || pathname.startsWith('/folder/')

  return (
    <div className="flex h-full flex-col gap-1 p-4">
      <div className="mb-5 flex items-center gap-2.5 px-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-white">
          <Send className="h-5 w-5" />
        </div>
        <span className="text-lg font-semibold">TeleDrive</span>
      </div>

      <button className="btn-primary mb-1 justify-start py-2.5" onClick={onUpload}>
        <Upload className="h-4 w-4" /> Upload files
      </button>
      <button className="btn-ghost mb-4 justify-start py-2.5" onClick={onNewFolder}>
        <FolderPlus className="h-4 w-4" /> New folder
      </button>

      <nav className="space-y-0.5">
        <Link to="/" icon={HardDrive} label="My Drive" active={inDrive} />
        <Link to="/recent" icon={Clock} label="Recent" />
        <Link to="/starred" icon={Star} label="Starred" />
        <Link to="/trash" icon={Trash2} label="Trash" />
      </nav>

      <div className="mt-auto space-y-3">
        <div className="rounded-xl bg-slate-100 p-3 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-400">
          <p className="font-medium text-slate-900 dark:text-slate-100">{formatBytes(stats.bytes)} used</p>
          <p>
            {stats.files} files · {stats.folders} folders
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
