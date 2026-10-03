import { ChevronRight, ExternalLink, Folder, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Native, type MediaFolder } from '../native/android'
import {
  addRange, CAMERA_PATH, enableBackup, folderLabel, requestMediaPermission, runBackup, setSource, setSourceWhen, sourcesOf,
  updateBackupSettings, useBackup, type BackupSource, type BackupWhen,
} from '../native/backup'
import { dayRange, NO_NEW, rangeLabel } from '../native/backupRange'
import DateRangePicker, { initialDays, validDays, type Days } from './DateRangePicker'
import { driveName, isPhotosDrive, PHOTOS_NAME } from '../telegram/channel'
import { useDrive } from '../store/useDrive'
import { toastError } from '../store/useToast'
import { Checkbox, Choice as UiChoice, Segmented, Toggle as Switch } from './ui'

const time = (ms: number) => new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/** Settings → Camera backup (Android app, shown while TelePhotos is open). Backups always go to TelePhotos. */
export default function CameraBackupSettings() {
  const { settings, status, running, backedUp, lastCheck, tonight } = useBackup()
  const anyOvernight = sourcesOf(settings).some((s) => s.when === 'overnight')
  const encrypted = useDrive((s) => !!s.drive.encryption)
  // Backups set up before TelePhotos still go to the drive they were turned on in
  const elsewhere = useDrive((s) => {
    const d = settings.driveId ? s.drives.find((x) => x.id === settings.driveId) : undefined
    return d && !isPhotosDrive(d) ? driveName(d) : null
  })
  const [scope, setScope] = useState<'new' | 'all' | 'range'>('new')
  const [days, setDays] = useState<Days>(initialDays)
  const [alsoNew, setAlsoNew] = useState(true)
  const [canRead, setCanRead] = useState(false)
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
      const now = Math.floor(Date.now() / 1000)
      const since = scope === 'all' ? 0 : scope === 'range' && !alsoNew ? NO_NEW : now
      // Keep the folders chosen before (if any), otherwise start with the camera
      let sources: BackupSource[] = settings.sources?.length ? settings.sources : [{ path: CAMERA_PATH, since }]
      if (scope === 'range') {
        const range = dayRange(days.from, days.to)
        const camera = sources.find((s) => s.path === CAMERA_PATH)
        sources = camera
          ? sources.map((s) => (s === camera ? { ...s, ranges: [...(s.ranges ?? []), range] } : s))
          : [...sources, { path: CAMERA_PATH, since, ranges: [range] }]
      }
      await enableBackup({ since: since === NO_NEW ? now : since, sources })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 px-4 py-4 text-sm sm:px-5">
        {settings.enabled && elsewhere ? (
          <div className="space-y-3 rounded-md p-3.5 pressed">
            <p>
              Backups still go to the <b>Camera Backup</b> folder in <b>{elsewhere}</b>.
            </p>
            <p className="text-xs text-muted">
              Switching sends new photos and videos to {PHOTOS_NAME}. What's already backed up stays where it is and
              isn't uploaded again.
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost font-semibold text-brand-ink" onClick={() => void updateBackupSettings({ enabled: false })}>
                Turn off
              </button>
              <button className="btn-primary" onClick={() => enableBackup().catch(toastError)}>
                Back up to {PHOTOS_NAME} instead
              </button>
            </div>
          </div>
        ) : settings.enabled ? (
          <>
            <div className="rounded-md p-3.5 pressed">
              <p className="flex items-center gap-2 font-medium">
                {running && <Loader2 className="h-4 w-4 animate-spin" />} {status}
              </p>
              <p className="text-xs text-muted">
                {backedUp} item{backedUp === 1 ? '' : 's'} backed up
                {lastCheck && ` · checked ${new Date(lastCheck).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`}
                {anyOvernight && tonight > 0 && ` · ${tonight} waiting for tonight`}
              </p>
            </div>
            <FolderList />
            <Toggle
              label="Only on Wi-Fi"
              hint="Don't use mobile data for backups"
              checked={settings.wifiOnly}
              onChange={(wifiOnly) => void updateBackupSettings({ wifiOnly })}
            />
            {anyOvernight && (
              <Toggle
                label="Only while charging"
                hint="For folders backed up overnight"
                checked={!!settings.charging}
                onChange={(charging) => void updateBackupSettings({ charging })}
              />
            )}
            <BackgroundInfo encrypted={encrypted} />
            <div className="flex justify-end gap-2">
              <button className="btn-ghost font-semibold text-brand-ink" onClick={() => void updateBackupSettings({ enabled: false })}>
                Turn off
              </button>
              <button className="btn-primary" disabled={running} onClick={() => void runBackup('all')}>
                Back up now
              </button>
            </div>
          </>
        ) : (
          <>
            <fieldset className="space-y-2">
              <Choice checked={scope === 'new'} onChange={() => setScope('new')} label="Only new photos and videos" hint="Taken from now on" />
              <Choice checked={scope === 'all'} onChange={() => setScope('all')} label="Everything in the camera folder" hint="Can be a lot of data" />
              <Choice
                checked={scope === 'range'}
                onChange={() => {
                  setScope('range')
                  // Counting what's in the dates needs to read the photos
                  void requestMediaPermission().then(setCanRead, () => setCanRead(false))
                }}
                label="From a date range"
                hint="Photos and videos taken between two dates"
              />
            </fieldset>
            {scope === 'range' && (
              <div className="space-y-3 rounded-md p-3.5 pressed">
                {canRead ? (
                  <DateRangePicker path={CAMERA_PATH} value={days} onChange={setDays} />
                ) : (
                  <p className="text-xs text-muted">TeleDrive needs permission to read your photos and videos.</p>
                )}
                <Checkbox checked={alsoNew} onChange={setAlsoNew}>
                  Also back up new photos and videos
                </Checkbox>
              </div>
            )}
            <Toggle
              label="Only on Wi-Fi"
              hint="Don't use mobile data for backups"
              checked={settings.wifiOnly}
              onChange={(wifiOnly) => void updateBackupSettings({ wifiOnly })}
            />
            <p className="text-xs text-muted">
              New photos upload within a few minutes, also while TeleDrive is closed. You can add more folders after
              turning this on.
            </p>
            {error && <p className="font-semibold text-brand-ink">{error}</p>}
            <div className="flex justify-end">
              <button className="btn-primary" disabled={busy || (scope === 'range' && !validDays(days))} onClick={enable}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Turn on
              </button>
            </div>
          </>
        )}
    </div>
  )
}

/** Folders on the phone with photos/videos, each with an on/off switch. */
function FolderList() {
  const settings = useBackup((s) => s.settings)
  const [folders, setFolders] = useState<MediaFolder[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** A folder just switched on: ask whether to include what's already in it. */
  const [asking, setAsking] = useState<MediaFolder | null>(null)
  /** Choosing dates: for a folder being switched on (`asking`), or older photos for one that's on. */
  const [ranging, setRanging] = useState<{ path: string; adding: boolean } | null>(null)
  const [days, setDays] = useState<Days>(initialDays)
  const [alsoNew, setAlsoNew] = useState(true)
  const startRange = (path: string, adding: boolean) => {
    setDays(initialDays())
    setAlsoNew(true)
    setRanging({ path, adding })
  }
  const saveRange = () => {
    if (!ranging) return
    const range = dayRange(days.from, days.to)
    if (ranging.adding) void addRange(ranging.path, range)
    else void setSource(ranging.path, true, alsoNew ? undefined : NO_NEW, range)
    setRanging(null)
    setAsking(null)
  }
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

  if (error) return <p className="font-semibold text-brand-ink">{error}</p>
  if (!folders)
    return (
      <p className="flex items-center gap-2 text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Looking for folders…
      </p>
    )

  return (
    <div>
      <p className="mb-1 font-medium">Folders</p>
      <ul className="max-h-80 divide-y-2 divide-line overflow-y-auto rounded-md px-1 pressed">
        {folders.map((f) => (
          <li key={f.path} className="px-3 py-2">
            <label className="flex cursor-pointer items-center gap-3">
              <FolderThumb uri={f.sampleUri} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{f.path === CAMERA_PATH ? 'Camera' : folderLabel(f.path)}</span>
                <span className="block truncate text-xs text-muted">
                  {f.count} item{f.count === 1 ? '' : 's'} · {f.path}
                </span>
              </span>
              <input
                type="checkbox"
                className="h-5 w-5 accent-brand"
                checked={chosen.has(f.path) || asking?.path === f.path}
                onChange={(e) => {
                  if (e.target.checked) setAsking(f)
                  else {
                    if (asking?.path === f.path) setAsking(null)
                    if (ranging?.path === f.path) setRanging(null)
                    void setSource(f.path, false)
                  }
                }}
              />
            </label>
            {chosen.has(f.path) && (
              <div className="mt-2 flex flex-wrap items-center gap-2 pl-12">
                <Segmented<BackupWhen>
                  small
                  label={`When to back up ${f.path === CAMERA_PATH ? 'Camera' : folderLabel(f.path)}`}
                  value={chosen.get(f.path)?.when ?? 'instant'}
                  options={[
                    { value: 'instant', label: 'As taken' },
                    { value: 'overnight', label: 'Overnight' },
                  ]}
                  onChange={(when) => void setSourceWhen(f.path, when)}
                />
                {ranging?.path !== f.path && (
                  <button className="btn-ghost h-8 px-2.5 text-xs" onClick={() => startRange(f.path, true)}>
                    Back up older photos…
                  </button>
                )}
                <RangesNote source={chosen.get(f.path)!} />
              </div>
            )}
            {ranging?.path === f.path && (
              <div className="mt-3 space-y-3 rounded-md p-3 raised-sm">
                <DateRangePicker path={f.path} value={days} onChange={setDays} />
                {!ranging.adding && (
                  <Checkbox checked={alsoNew} onChange={setAlsoNew}>
                    Also back up new photos and videos
                  </Checkbox>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    className="btn-ghost h-9 text-xs text-muted"
                    onClick={() => {
                      setRanging(null)
                      setAsking(null)
                    }}
                  >
                    Cancel
                  </button>
                  <button className="btn-primary h-9 text-xs" disabled={!validDays(days)} onClick={saveRange}>
                    Back up
                  </button>
                </div>
              </div>
            )}
            {asking?.path === f.path && ranging?.path !== f.path && (
              <div className="mt-2 flex flex-wrap items-center gap-1 pl-12">
                <span className="text-xs text-muted">Back up:</span>
                <button
                  className="btn-ghost h-8 px-2.5 text-xs"
                  onClick={() => {
                    setAsking(null)
                    void setSource(f.path, true)
                  }}
                >
                  Only new
                </button>
                <button
                  className="btn-ghost h-8 px-2.5 text-xs"
                  onClick={() => {
                    setAsking(null)
                    void setSource(f.path, true, 0)
                  }}
                >
                  All {f.count} items
                </button>
                <button className="btn-ghost h-8 px-2.5 text-xs" onClick={() => startRange(f.path, false)}>
                  Date range…
                </button>
                <button className="btn-ghost h-8 px-2.5 text-xs text-muted" onClick={() => setAsking(null)}>
                  Cancel
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A folder's date ranges still being backed up ("Also 12 Aug – 20 Aug 2024"), or "Only …" without new photos. */
function RangesNote({ source }: { source: BackupSource }) {
  if (!source.ranges?.length) return null
  const labels = source.ranges.map(rangeLabel).join(', ')
  return (
    <span className="basis-full text-xs text-muted">
      {source.since === NO_NEW ? 'Only' : 'Also'} photos from {labels}
    </span>
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
    <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface raised-xs">
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <Folder className="size-4 text-muted" />}
    </span>
  )
}

/** Last background run, plus what some phones need for it to work (folded away under "Notice"). */
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
    <details className="group rounded-md text-xs leading-relaxed pressed">
      <summary className="flex list-none items-center justify-between gap-2 p-3.5 font-bold [&::-webkit-details-marker]:hidden">
        Notice
        <ChevronRight className="size-4 text-muted transition-transform duration-120 group-open:rotate-90" />
      </summary>
      <div className="space-y-2 px-3.5 pb-3.5">
        <p>
          On Xiaomi, Redmi, POCO and some other phones, background work is blocked unless you allow it: in the app settings turn on
          <b> Autostart</b> and set <b>Battery saver</b> to <b>No restrictions</b>.
        </p>
        {encrypted && <p>This drive is encrypted: background backup only works if "Remember on this device" was ticked when unlocking.</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted">
            {last?.lastRun ? `Last background run: ${time(last.lastRun)}${last.status ? ` (${last.status})` : ''}` : 'Not run in the background yet'}
          </span>
          <button className="btn-ghost py-1 text-xs" onClick={() => void Native.openAppSettings()}>
            <ExternalLink className="h-3.5 w-3.5" /> App settings
          </button>
        </div>
      </div>
    </details>
  )
}

function Toggle(props: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>
        <span className="block font-bold">{props.label}</span>
        <span className="block text-xs text-muted">{props.hint}</span>
      </span>
      <Switch label={props.label} checked={props.checked} onChange={props.onChange} />
    </div>
  )
}

function Choice(props: { label: string; hint: string; checked: boolean; onChange: () => void }) {
  return <UiChoice name="backup-choice" {...props} />
}
