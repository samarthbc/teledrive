import { Camera, ExternalLink, Folder, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Native, type MediaFolder } from '../../native/android'
import {
  CAMERA_PATH, folderLabel, requestMediaPermission, runBackup, setSource, sourcesOf, updateBackupSettings, useBackup,
} from '../../native/backup'
import { useDrive } from '../../store/useDrive'
import Dialog from '../Dialog'

const time = (ms: number) => new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

export default function CameraBackupDialog({ onClose }: { onClose: () => void }) {
  const { settings, status, running, backedUp, lastCheck } = useBackup()
  const encrypted = useDrive((s) => !!s.drive.encryption)
  const [scope, setScope] = useState<'new' | 'all'>('new')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void runBackup() // also loads saved settings
  }, [])

  const enable = async () => {
    setBusy(true)
    setError(null)
    try {
      if (!(await requestMediaPermission())) {
        setError('TeleDrive needs permission to read your photos and videos. Allow it in Android Settings → Apps → TeleDrive → Permissions.')
        return
      }
      const since = scope === 'new' ? Math.floor(Date.now() / 1000) : 0
      // Keep the folders chosen before (if any), otherwise start with the camera
      const sources = settings.sources?.length ? settings.sources : [{ path: CAMERA_PATH, since }]
      await updateBackupSettings({ enabled: true, since, sources })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="Camera backup" onClose={onClose} wide>
      <div className="space-y-4 pb-4 text-sm">
        <div className="flex items-start gap-3">
          <Camera className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
          <p className="text-slate-600 dark:text-slate-400">
            New photos and videos are uploaded to the <b>Camera Backup</b> folder. Other folders you pick (Screenshots,
            WhatsApp Images…) go into their own subfolder there.
          </p>
        </div>

        {settings.enabled ? (
          <>
            <div className="rounded-xl bg-slate-100 p-3 dark:bg-slate-800/60">
              <p className="flex items-center gap-2 font-medium">
                {running && <Loader2 className="h-4 w-4 animate-spin" />} {status}
              </p>
              <p className="text-xs text-slate-500">
                {backedUp} item{backedUp === 1 ? '' : 's'} backed up
                {lastCheck && ` · checked ${new Date(lastCheck).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`}
              </p>
            </div>
            <FolderList />
            <Toggle
              label="Only on Wi-Fi"
              hint="Don't use mobile data for backups"
              checked={settings.wifiOnly}
              onChange={(wifiOnly) => void updateBackupSettings({ wifiOnly })}
            />
            <Toggle
              label="Back up when the app is closed"
              hint="New photos upload within a few minutes, even with TeleDrive closed"
              checked={!!settings.background}
              onChange={(background) => void updateBackupSettings({ background })}
            />
            {settings.background && <BackgroundInfo encrypted={encrypted} />}
            <div className="flex justify-end gap-2">
              <button className="btn-ghost text-red-600 dark:text-red-400" onClick={() => void updateBackupSettings({ enabled: false })}>
                Turn off
              </button>
              <button className="btn-primary" disabled={running} onClick={() => void runBackup()}>
                Back up now
              </button>
            </div>
          </>
        ) : (
          <>
            <fieldset className="space-y-2">
              <Choice checked={scope === 'new'} onChange={() => setScope('new')} label="Only new photos and videos" hint="Taken from now on" />
              <Choice checked={scope === 'all'} onChange={() => setScope('all')} label="Everything in the camera folder" hint="Can be a lot of data" />
            </fieldset>
            <Toggle
              label="Only on Wi-Fi"
              hint="Don't use mobile data for backups"
              checked={settings.wifiOnly}
              onChange={(wifiOnly) => void updateBackupSettings({ wifiOnly })}
            />
            <p className="text-xs text-slate-500">You can add more folders and turn on backup while the app is closed after turning this on.</p>
            {error && <p className="text-red-600">{error}</p>}
            <div className="flex justify-end">
              <button className="btn-primary" disabled={busy} onClick={enable}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Turn on
              </button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}

/** Folders on the phone with photos/videos, each with an on/off switch. */
function FolderList() {
  const settings = useBackup((s) => s.settings)
  const [folders, setFolders] = useState<MediaFolder[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** A folder just switched on: ask whether to include what's already in it. */
  const [asking, setAsking] = useState<MediaFolder | null>(null)
  const chosen = new Map(sourcesOf(settings).map((s) => [s.path, s]))

  useEffect(() => {
    Native.listMediaFolders().then(
      ({ folders }) => {
        // Camera first, then the biggest folders
        const sorted = [...folders].sort((a, b) => Number(b.path === CAMERA_PATH) - Number(a.path === CAMERA_PATH) || b.count - a.count)
        setFolders(sorted)
      },
      (e) => setError(e instanceof Error ? e.message : String(e)),
    )
  }, [])

  if (error) return <p className="text-red-600">{error}</p>
  if (!folders)
    return (
      <p className="flex items-center gap-2 text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Looking for folders…
      </p>
    )

  return (
    <div>
      <p className="mb-1 font-medium">Folders</p>
      <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
        {folders.map((f) => (
          <li key={f.path} className="px-3 py-2">
            <label className="flex cursor-pointer items-center gap-3">
              <FolderThumb uri={f.sampleUri} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{f.path === CAMERA_PATH ? 'Camera' : folderLabel(f.path)}</span>
                <span className="block truncate text-xs text-slate-500">
                  {f.count} item{f.count === 1 ? '' : 's'} · {f.path}
                </span>
              </span>
              <input
                type="checkbox"
                className="h-5 w-5 accent-brand"
                checked={chosen.has(f.path) || asking?.path === f.path}
                onChange={(e) => {
                  if (e.target.checked) setAsking(f)
                  else void setSource(f.path, false)
                }}
              />
            </label>
            {asking?.path === f.path && (
              <div className="mt-2 flex flex-wrap items-center gap-2 pl-12">
                <span className="text-xs text-slate-500">Back up:</span>
                <button
                  className="btn-ghost py-1 text-xs"
                  onClick={() => {
                    setAsking(null)
                    void setSource(f.path, true)
                  }}
                >
                  Only new
                </button>
                <button
                  className="btn-ghost py-1 text-xs"
                  onClick={() => {
                    setAsking(null)
                    void setSource(f.path, true, 0)
                  }}
                >
                  All {f.count} items
                </button>
                <button className="btn-ghost py-1 text-xs text-slate-500" onClick={() => setAsking(null)}>
                  Cancel
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-slate-500">
        WhatsApp's "Sent" folders are hidden from other apps, so only received media can be backed up.
      </p>
    </div>
  )
}

function FolderThumb({ uri }: { uri: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    Native.thumbnail({ uri }).then(({ data }) => alive && data && setSrc(`data:image/jpeg;base64,${data}`), () => {})
    return () => {
      alive = false
    }
  }, [uri])
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <Folder className="h-4 w-4 text-slate-400" />}
    </span>
  )
}

/** Last background run, plus what some phones need for it to work. */
function BackgroundInfo({ encrypted }: { encrypted: boolean }) {
  const [last, setLast] = useState<{ lastRun: number; status: string } | null>(null)
  useEffect(() => {
    Native.backgroundBackupStatus().then(({ lastRun, lastResult }) => {
      let s = ''
      try {
        const r = JSON.parse(lastResult || '{}')
        s = r.uploaded ? `backed up ${r.uploaded}` : (r.status ?? '')
      } catch {
        // ignore
      }
      setLast({ lastRun, status: s })
    }, () => {})
  }, [])

  return (
    <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
      <p>
        On Xiaomi, Redmi, POCO and some other phones, background work is blocked unless you allow it: in the app settings turn on
        <b> Autostart</b> and set <b>Battery saver</b> to <b>No restrictions</b>.
      </p>
      {encrypted && <p>This drive is encrypted: background backup only works if "Remember on this device" was ticked when unlocking.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-amber-800/80 dark:text-amber-200/70">
          {last?.lastRun ? `Last background run: ${time(last.lastRun)}${last.status ? ` (${last.status})` : ''}` : 'Not run in the background yet'}
        </span>
        <button className="btn-ghost py-1 text-xs" onClick={() => void Native.openAppSettings()}>
          <ExternalLink className="h-3.5 w-3.5" /> App settings
        </button>
      </div>
    </div>
  )
}

function Toggle(props: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span>
        <span className="block font-medium">{props.label}</span>
        <span className="block text-xs text-slate-500">{props.hint}</span>
      </span>
      <input type="checkbox" className="h-5 w-5 accent-brand" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
    </label>
  )
}

function Choice(props: { label: string; hint: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <input type="radio" className="mt-1 accent-brand" checked={props.checked} onChange={props.onChange} />
      <span>
        <span className="block font-medium">{props.label}</span>
        <span className="block text-xs text-slate-500">{props.hint}</span>
      </span>
    </label>
  )
}
