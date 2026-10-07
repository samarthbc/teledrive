import { Loader2, MonitorSmartphone, TriangleAlert } from 'lucide-react'
import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import DrivePage, { type Mode } from './pages/Drive'
import VaultPage from './pages/Vault'
import LoginPage from './pages/Login'
import PasswordPage from './pages/Password'
import SetupPage from './pages/Setup'
import { backupDriveOpened, initCameraBackup } from './native/backup'
import { driveName } from './telegram/channel'
import { useDrive, useInVault } from './store/useDrive'

let backupStarted = false

export default function App() {
  const phase = useDrive((s) => s.phase)
  const error = useDrive((s) => s.error)
  const boot = useDrive((s) => s.boot)

  useEffect(() => {
    void boot()
  }, [boot])

  useEffect(() => {
    if (phase !== 'ready' || backupStarted) return
    backupStarted = true
    initCameraBackup({
      ready: () => useDrive.getState().phase === 'ready',
      drive: () => useDrive.getState().drive,
      driveName: (id) => {
        const d = useDrive.getState().drives.find((x) => x.id === id)
        return d && driveName(d)
      },
      openForBackup: (id) => useDrive.getState().openForBackup(id),
      returnFromBackup: () => useDrive.getState().returnFromBackup(),
      photosDriveId: () => useDrive.getState().ensurePhotosDrive().then((d) => d.id),
    })
    // Opening the backup drive backs up what waited meanwhile (not when a background round opened it: it does that)
    useDrive.subscribe((s, prev) => {
      const opened = s.phase === 'ready' && (prev.phase !== 'ready' || s.currentDrive !== prev.currentDrive)
      if (opened && !s.returnTo) backupDriveOpened()
    })
  }, [phase])

  if (phase === 'setup') return <SetupPage />
  if (phase === 'login') return <LoginPage />
  if (phase === 'password') return <PasswordPage />
  if (phase === 'otherTab')
    return (
      <Centered>
        <MonitorSmartphone className="size-10 text-brand-ink" />
        <p className="text-xl font-black tracking-[-0.02em]">TeleDrive is open in another tab</p>
        <p className="max-w-sm text-center text-sm text-muted">
          Using it in two tabs at once can make Telegram end your session, so only one tab can be active.
        </p>
        <button className="btn-primary" onClick={() => void boot(true)}>
          Use here instead
        </button>
      </Centered>
    )
  if (phase === 'error')
    return (
      <Centered>
        <TriangleAlert className="size-10 text-brand-ink" />
        <p className="max-w-sm text-center text-sm text-muted">{error}</p>
        <button className="btn-primary" onClick={() => void boot()}>
          Try again
        </button>
      </Centered>
    )
  if (phase !== 'ready')
    return (
      <Centered>
        <Loader2 className="size-8 animate-spin text-brand-ink" />
        <p className="text-sm text-muted">{phase === 'loading' ? 'Loading your drive…' : 'Connecting to Telegram…'}</p>
      </Centered>
    )

  return (
    <Routes>
      <Route path="/" element={<Page mode="folder" />} />
      <Route path="/folder/:folderId" element={<Page mode="folder" />} />
      <Route path="/search" element={<Page mode="search" />} />
      <Route path="/recent" element={<Page mode="recent" />} />
      <Route path="/starred" element={<Page mode="starred" />} />
      <Route path="/albums" element={<Page mode="albums" />} />
      <Route path="/album/:albumId" element={<Page mode="album" />} />
      <Route path="/locked" element={<Page mode="locked" />} />
      <Route path="/trash" element={<Page mode="trash" />} />
      <Route path="/settings" element={<Page mode="settings" />} />
      {/* TeleWarden's own places */}
      <Route path="/v/*" element={<Page mode="folder" />} />
      <Route path="/generator" element={<Page mode="folder" />} />
      <Route path="/codes" element={<Page mode="folder" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

/** TeleWarden has its own page; every other drive is files (or photos). */
function Page({ mode }: { mode: Mode }) {
  const inVault = useInVault()
  return inVault ? <VaultPage /> : <DrivePage mode={mode} />
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-4 p-6">{children}</div>
}
