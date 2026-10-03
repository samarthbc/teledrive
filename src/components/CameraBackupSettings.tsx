import { ChevronRight, ExternalLink, Folder, History, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Native, type MediaFolder } from '../native/android'
import {
  addRange, CAMERA_PATH, enableBackup, folderLabel, requestMediaPermission, runBackup, setSource, setSourceSince, setSourceWhen,
  sourcesOf, updateBackupSettings, useBackup, type BackupSource, type BackupWhen,
} from '../native/backup'
import { dayRange, NO_NEW, rangeLabel } from '../native/backupRange'
import DateRangePicker, { initialDays, validDays, type Days } from './DateRangePicker'
import Dialog from './Dialog'
import { driveName, isPhotosDrive, PHOTOS_NAME } from '../telegram/channel'
import { useDrive } from '../store/useDrive'
import { toast, toastError } from '../store/useToast'
import { Checkbox, Choice as UiChoice, Segmented, Toggle as Switch } from './ui'

const time = (ms: number) => new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const day = (s: number) => new Date(s * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
const label = (path: string) => (path === CAMERA_PATH ? 'Camera' : folderLabel(path))

/**
 * Settings → Camera backup (Android app, shown while TelePhotos is open). Backups always go to TelePhotos. A short
 * summary; the folders and each folder's options are in the Backup folders dialog.
 */
export default function CameraBackupSettings() {
  const { settings, status, running, backedUp, lastCheck, tonight } = useBackup()
  const sources = sourcesOf(settings)
  const anyOvernight = sources.some((s) => s.when === 'overnight')
  const encrypted = useDrive((s) => !!s.drive.encryption)
  // Backups set up before TelePhotos still go to the drive they were turned on in
  const elsewhere = useDrive((s) => {
    const d = settings.driveId ? s.drives.find((x) => x.id === settings.driveId) : undefined
    return d && !isPhotosDrive(d) ? driveName(d) : null
  })
  const [folders, setFolders] = useState(false)

  useEffect(() => {
    void runBackup() // also loads saved settings
  }, [])

  if (settings.enabled && elsewhere)
    return (
      <div className="space-y-3 px-4 py-4 text-sm sm:px-5">
        <p>
          Backups still go to the <b>Camera Backup</b> folder in <b>{elsewhere}</b>.
        </p>
        <p className="text-xs text-muted">
          Switching sends new photos and videos to {PHOTOS_NAME}. What's already backed up stays where it is and isn't
          uploaded again.
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
    )

  if (!settings.enabled) return <TurnOn />

  const older = sources.some((s) => s.ranges?.length)
  return (
    <>
      <div className="flex items-center gap-3 px-4 py-4 sm:px-5">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-bold">
            {running && <Loader2 className="size-4 shrink-0 animate-spin" />} <span className="truncate">{status}</span>
          </p>
          <p className="mt-0.5 text-[13px] text-muted">
            {backedUp} backed up
            {lastCheck && ` · checked ${new Date(lastCheck).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`}
            {anyOvernight && tonight > 0 && ` · ${tonight} waiting for tonight`}
          </p>
        </div>
        <button className="btn-secondary shrink-0" disabled={running} onClick={() => void runBackup('all')}>
          Back up now
        </button>
      </div>
      <Row name="Camera backup" hint={`Photos and videos go to ${PHOTOS_NAME}`}>
        <Switch label="Camera backup" checked onChange={() => void updateBackupSettings({ enabled: false })} />
      </Row>
      <button className="flex w-full items-center gap-3 px-4 py-4 text-left sm:px-5" onClick={() => setFolders(true)}>
        <span className="min-w-0 flex-1">
          <span className="block font-bold">Folders</span>
          <span className="mt-0.5 block truncate text-[13px] text-muted">
            {sources.length ? sources.map((s) => label(s.path)).join(', ') : 'None chosen'}
            {older && ' · older photos uploading'}
          </span>
        </span>
        <ChevronRight className="size-4.5 shrink-0 text-muted" />
      </button>
      <Row name="Only on Wi-Fi" hint="Don't use mobile data for backups">
        <Switch label="Only on Wi-Fi" checked={settings.wifiOnly} onChange={(wifiOnly) => void updateBackupSettings({ wifiOnly })} />
      </Row>
      {anyOvernight && (
        <Row name="Only while charging" hint="For folders backed up overnight">
          <Switch label="Only while charging" checked={!!settings.charging} onChange={(charging) => void updateBackupSettings({ charging })} />
        </Row>
      )}
      <BackgroundInfo encrypted={encrypted} />
      {folders && <FoldersDialog onClose={() => setFolders(false)} />}
    </>
  )
}

/** Camera backup while it's off: where to start from, then Turn on. */
function TurnOn() {
  const settings = useBackup((s) => s.settings)
  const [scope, setScope] = useState<'new' | 'all' | 'range'>('new')
  const [days, setDays] = useState<Days>(initialDays)
  const [alsoNew, setAlsoNew] = useState(true)
  const [canRead, setCanRead] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
      <div className="flex items-center justify-between gap-3">
        <span>
          <span className="block font-bold">Only on Wi-Fi</span>
          <span className="block text-xs text-muted">Don't use mobile data for backups</span>
        </span>
        <Switch label="Only on Wi-Fi" checked={settings.wifiOnly} onChange={(wifiOnly) => void updateBackupSettings({ wifiOnly })} />
      </div>
      <p className="text-xs text-muted">
        New photos upload within a few minutes, also while TeleDrive is closed. You can add more folders after turning
        this on.
      </p>
      {error && <p className="font-semibold text-brand-ink">{error}</p>}
      <div className="flex justify-end">
        <button className="btn-primary" disabled={busy || (scope === 'range' && !validDays(days))} onClick={enable}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Turn on
        </button>
      </div>
    </div>
  )
}

type View = { kind: 'list' } | { kind: 'folder'; path: string } | { kind: 'older'; path: string }

/**
 * Backup folders: the phone's folders (the backed-up ones first) with a switch each; tapping a backed-up one shows
 * its options (when, what, older photos). Back goes up one level.
 */
function FoldersDialog({ onClose }: { onClose: () => void }) {
  const settings = useBackup((s) => s.settings)
  const chosen = new Map(sourcesOf(settings).map((s) => [s.path, s]))
  const [folders, setFolders] = useState<MediaFolder[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>({ kind: 'list' })
  const [days, setDays] = useState<Days>(initialDays)

  useEffect(() => {
    Native.listMediaFolders().then(
      ({ folders }) => setFolders([...folders].sort((a, b) => Number(b.path === CAMERA_PATH) - Number(a.path === CAMERA_PATH) || b.count - a.count)),
      (e) => setError(e instanceof Error ? e.message : String(e)),
    )
  }, [])

  const info = (path: string) => folders?.find((f) => f.path === path)
  const back = () => {
    if (view.kind === 'older') setView({ kind: 'folder', path: view.path })
    else if (view.kind === 'folder') setView({ kind: 'list' })
    else onClose()
  }

  if (view.kind === 'older') {
    const valid = validDays(days)
    return (
      <Dialog
        title="Back up older photos"
        subtitle={`${label(view.path)} · new photos keep backing up as usual`}
        onClose={back}
        footer={
          <>
            <button className="btn-ghost" onClick={back}>
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={!valid}
              onClick={() => {
                const range = dayRange(days.from, days.to)
                void addRange(view.path, range).then(() => toast(`Backing up ${label(view.path)} photos from ${rangeLabel(range)}`), toastError)
                setView({ kind: 'folder', path: view.path })
              }}
            >
              Back up
            </button>
          </>
        }
      >
        <div className="pb-2">
          <DateRangePicker path={view.path} value={days} onChange={setDays} />
        </div>
      </Dialog>
    )
  }

  const source = view.kind === 'folder' ? chosen.get(view.path) : undefined
  if (view.kind === 'folder' && source) {
    const f = info(view.path)
    const what = source.since === 0 ? 'all' : source.since === NO_NEW ? 'none' : 'new'
    return (
      <Dialog
        title={label(view.path)}
        subtitle={[f && `${f.count.toLocaleString()} items`, view.path].filter(Boolean).join(' · ')}
        onClose={back}
        footer={
          <>
            <button
              className="btn-ghost text-brand-ink"
              onClick={() => {
                void setSource(view.path, false)
                setView({ kind: 'list' })
              }}
            >
              Stop backing up
            </button>
            <button className="btn-primary" onClick={() => setView({ kind: 'list' })}>
              Done
            </button>
          </>
        }
      >
        <div className="space-y-5 pb-2 text-sm">
          <div>
            <p className="field-label">When</p>
            <Segmented<BackupWhen>
              label={`When to back up ${label(view.path)}`}
              value={source.when ?? 'instant'}
              options={[
                { value: 'instant', label: 'As taken' },
                { value: 'overnight', label: 'Overnight' },
              ]}
              onChange={(when) => void setSourceWhen(view.path, when)}
            />
            <p className="mt-1.5 text-xs text-muted">
              {source.when === 'overnight' ? 'Once a day, around 1 AM' : 'Within a few minutes of each photo, also while TeleDrive is closed'}
            </p>
          </div>
          <div>
            <p className="field-label">What</p>
            <Segmented<string>
              label={`What to back up from ${label(view.path)}`}
              value={what}
              options={[
                { value: 'new', label: 'New only' },
                { value: 'all', label: 'Everything' },
              ]}
              onChange={(v) => void setSourceSince(view.path, v === 'all' ? 0 : Math.floor(Date.now() / 1000))}
            />
            <p className="mt-1.5 text-xs text-muted">
              {what === 'all'
                ? `Everything in ${label(view.path)}`
                : what === 'none'
                  ? 'No new photos: only the dates below'
                  : `Taken since ${day(source.since)}`}
            </p>
          </div>
          {!!source.ranges?.length && (
            <p className="rounded-md p-3 text-xs pressed">
              <b>Older photos:</b> {source.ranges.map(rangeLabel).join(', ')} <span className="text-muted">(until they're backed up)</span>
            </p>
          )}
          {what !== 'all' && (
            <button
              className="flex w-full items-center gap-3 rounded-md p-3.5 text-left raised-sm active:pressed"
              onClick={() => {
                setDays(initialDays())
                setView({ kind: 'older', path: view.path })
              }}
            >
              <History className="size-5 shrink-0 text-brand-ink" />
              <span className="min-w-0 flex-1">
                <span className="block font-bold">Back up older photos…</span>
                <span className="block text-xs text-muted">Pick dates</span>
              </span>
              <ChevronRight className="size-4.5 shrink-0 text-muted" />
            </button>
          )}
        </div>
      </Dialog>
    )
  }

  const on = [...chosen.values()]
  const off = (folders ?? []).filter((f) => !chosen.has(f.path))
  return (
    <Dialog title="Backup folders" subtitle="Tap a backed-up folder for its options" onClose={back} wide>
      <div className="space-y-5 pb-4 text-sm">
        {error && <p className="font-semibold text-brand-ink">{error}</p>}
        <div>
          <p className="label-swiss mb-2">Backed up</p>
          {on.length ? (
            <ul className="divide-y-2 divide-line rounded-md raised-sm">
              {on.map((s) => (
                <li key={s.path}>
                  <button className="flex w-full items-center gap-3 px-3 py-2.5 text-left" onClick={() => setView({ kind: 'folder', path: s.path })}>
                    <FolderThumb uri={info(s.path)?.sampleUri} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{label(s.path)}</span>
                      <span className="block truncate text-xs text-muted">
                        {s.when === 'overnight' ? 'Overnight' : 'As taken'} · {s.since === 0 ? 'everything' : s.since === NO_NEW ? 'dates only' : 'new only'}
                        {!!s.ranges?.length && ' · older photos uploading'}
                      </span>
                    </span>
                    <ChevronRight className="size-4.5 shrink-0 text-muted" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">No folders yet. Switch one on below.</p>
          )}
        </div>
        <div>
          <p className="label-swiss mb-2">On this phone</p>
          {!folders && !error ? (
            <p className="flex items-center gap-2 text-muted">
              <Loader2 className="size-4 animate-spin" /> Looking for folders…
            </p>
          ) : (
            <ul className="divide-y-2 divide-line rounded-md raised-sm">
              {off.map((f) => (
                <li key={f.path} className="flex items-center gap-3 px-3 py-2.5">
                  <FolderThumb uri={f.sampleUri} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{label(f.path)}</span>
                    <span className="block truncate text-xs text-muted">{f.count.toLocaleString()} items</span>
                  </span>
                  <Switch
                    label={`Back up ${label(f.path)}`}
                    checked={false}
                    onChange={() => {
                      // On with new photos only; its options open so they can be changed straight away
                      void setSource(f.path, true).then(() => setView({ kind: 'folder', path: f.path }), toastError)
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  )
}

function FolderThumb({ uri }: { uri?: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!uri) return
    let alive = true
    Native.thumbnail({ uri }).then(({ data }) => alive && data && setSrc(`data:image/jpeg;base64,${data}`), () => {})
    return () => {
      alive = false
    }
  }, [uri])
  return (
    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface raised-xs">
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
    <details className="group">
      <summary className="flex list-none items-center gap-3 px-4 py-4 sm:px-5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block font-bold">Notice</span>
          <span className="mt-0.5 block text-[13px] text-muted">Background backup on Xiaomi and other phones</span>
        </span>
        <ChevronRight className="size-4.5 shrink-0 text-muted transition-transform duration-120 group-open:rotate-90" />
      </summary>
      <div className="space-y-2 px-4 pb-4 text-xs leading-relaxed sm:px-5">
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

/** A setting with a switch on the right (as Settings' own rows). */
function Row(props: { name: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-5">
      <div className="min-w-0">
        <p className="font-bold">{props.name}</p>
        {props.hint && <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{props.hint}</p>}
      </div>
      {props.children}
    </div>
  )
}

function Choice(props: { label: string; hint: string; checked: boolean; onChange: () => void }) {
  return <UiChoice name="backup-choice" {...props} />
}
