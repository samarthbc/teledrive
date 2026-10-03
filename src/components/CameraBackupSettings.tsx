import { Camera, Check, ChevronDown, ChevronLeft, ChevronRight, Eraser, ExternalLink, Folder, History, Info, Loader2, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatBytes } from '../lib/format'
import { Native, type CameraItem, type MediaFolder } from '../native/android'
import { useBackHandler } from '../native/backButton'
import {
  addRange, CAMERA_PATH, enableBackup, findFreeable, folderLabel, freeUpSpace, requestMediaPermission, runBackup, setSource,
  setSourceSince, setSourceWhen, sourcesOf, updateBackupSettings, useBackup, type BackupSource, type BackupWhen,
} from '../native/backup'
import { dayRange, NO_NEW, quickRanges, rangeLabel, toDay } from '../native/backupRange'
import { DateField, initialDays, useRangeCount, validDays, type Days } from './DateRangePicker'
import ConfirmDialog from './dialogs/ConfirmDialog'
import Dialog from './Dialog'
import { driveName, isPhotosDrive, PHOTOS_NAME } from '../telegram/channel'
import { useDrive } from '../store/useDrive'
import { toast, toastError } from '../store/useToast'
import { Segmented, Toggle as Switch } from './ui'

const time = (ms: number) => new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const day = (s: number) => new Date(s * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
const label = (path: string) => (path === CAMERA_PATH ? 'Camera' : folderLabel(path))
const isScreenshots = (path: string) => /screenshot/i.test(path)
const folderIcon = (path: string) => (path === CAMERA_PATH ? Camera : isScreenshots(path) ? Smartphone : Folder)

/**
 * Settings → Camera backup (Android app, shown while TelePhotos is open; IMPLEMENTATION.md Phase 18): the status,
 * then the settings (Folders opens a screen of its own), then Free up space and Notice. Backups go to TelePhotos.
 */
export default function CameraBackupSettings() {
  const { settings, status, running, lastCheck, tonight } = useBackup()
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
      <div className="panel space-y-3 px-4 py-4 text-sm sm:px-5">
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

  if (!settings.enabled)
    return (
      <div className="space-y-5">
        <TurnOn />
        <div className="panel divide-y-2 divide-line">
          <FreeUpRow />
        </div>
      </div>
    )

  const upToDate = !running && status === 'Up to date'
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 rounded-md p-4 pressed">
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-full ${upToDate || running ? 'bg-brand text-white' : 'bg-surface text-muted raised-xs'}`}
        >
          {running ? <Loader2 className="size-4.5 animate-spin" /> : upToDate ? <Check className="size-4.5" strokeWidth={3} /> : <Info className="size-4.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base leading-snug font-extrabold break-words">{status}</p>
          {/* No "N backed up": what was backed up may since have been deleted from TelePhotos */}
          {(lastCheck || (anyOvernight && tonight > 0)) && (
            <p className="mt-0.5 text-[13px] text-muted">
              {[
                lastCheck && `Checked ${new Date(lastCheck).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
                anyOvernight && tonight > 0 && `${tonight} waiting for tonight`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
        </div>
        <button className="btn-secondary h-10 shrink-0 px-4" disabled={running} onClick={() => void runBackup('all')}>
          Back up now
        </button>
      </div>

      <div className="panel divide-y-2 divide-line">
        <Row name="Camera backup" hint={`Into ${PHOTOS_NAME}`}>
          <Switch label="Camera backup" checked onChange={() => void updateBackupSettings({ enabled: false })} />
        </Row>
        <NavRow
          name="Folders"
          hint={(sources.length ? sources.map((s) => label(s.path)).join(', ') : 'None chosen') + (sources.some((s) => s.ranges?.length) ? ' · older photos uploading' : '')}
          onClick={() => setFolders(true)}
        />
        <Row name="Only on Wi-Fi">
          <Switch label="Only on Wi-Fi" checked={settings.wifiOnly} onChange={(wifiOnly) => void updateBackupSettings({ wifiOnly })} />
        </Row>
        {anyOvernight && (
          <Row name="Only while charging" hint="For folders backed up overnight">
            <Switch label="Only while charging" checked={!!settings.charging} onChange={(charging) => void updateBackupSettings({ charging })} />
          </Row>
        )}
      </div>

      <div className="panel divide-y-2 divide-line">
        <FreeUpRow />
        <BackgroundInfo encrypted={encrypted} />
      </div>

      {folders && <FoldersScreen onClose={() => setFolders(false)} />}
    </div>
  )
}

/** Camera backup while it's off: just Turn on (the camera, new photos only); the rest is chosen once it's on. */
function TurnOn() {
  const settings = useBackup((s) => s.settings)
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
      const since = Math.floor(Date.now() / 1000)
      // Keep the folders chosen before (if any), otherwise start with the camera
      const sources: BackupSource[] = settings.sources?.length ? settings.sources : [{ path: CAMERA_PATH, since }]
      await enableBackup({ since, sources })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel space-y-3 px-4 py-4 sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold">Back up this phone's photos</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted">New photos and videos upload to {PHOTOS_NAME} as you take them.</p>
        </div>
        <button className="btn-primary shrink-0" disabled={busy} onClick={enable}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Turn on
        </button>
      </div>
      {error && <p className="text-sm font-semibold text-brand-ink">{error}</p>}
    </div>
  )
}

/** Free up space: remove photos and videos from the phone that are safely in TelePhotos (asks first). */
function FreeUpRow() {
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState<{ items: CameraItem[]; bytes: number } | null>(null)

  const check = async () => {
    setBusy(true)
    try {
      const f = await findFreeable()
      if (f.items.length) setFound(f)
      else toast('Nothing to free up: no backed-up photos or videos are left on this phone')
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  // "3 photos and 1 video"
  const videos = found?.items.filter((i) => i.mime.startsWith('video/')).length ?? 0
  const count = (k: number, word: string) => (k ? [`${k} ${word}${k === 1 ? '' : 's'}`] : [])
  const what = [...count((found?.items.length ?? 0) - videos, 'photo'), ...count(videos, 'video')].join(' and ')
  return (
    <>
      <NavRow name="Free up space" hint="Remove backed-up photos from this phone" busy={busy} onClick={() => void check()} />
      {found && (
        <ConfirmDialog
          title="Are you sure?"
          danger
          icon={Eraser}
          message={
            <>
              <p>
                <b className="text-ink">{what}</b> ({formatBytes(found.bytes)}) will be removed from this phone. Your
                backed-up copies stay in {PHOTOS_NAME}.
              </p>
              <p className="mt-2">
                They go to the phone's bin first and are deleted for good after 30 days. Android will ask you once more.
              </p>
            </>
          }
          confirmLabel={`Free up ${formatBytes(found.bytes)}`}
          onConfirm={async () => {
            if (await freeUpSpace(found.items)) toast(`Freed up ${formatBytes(found.bytes)}`)
          }}
          onClose={() => setFound(null)}
        />
      )}
    </>
  )
}

/** A screen of its own over Settings (full window), with a back button; the phone's back button closes it too. */
function Screen(props: { title: string; onBack: () => void; children: React.ReactNode; footer?: React.ReactNode; active?: boolean }) {
  useBackHandler(props.active ?? true, props.onBack)
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-surface">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-xl px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-6">
          <div className="flex items-center gap-3.5">
            <button className="icon-btn" onClick={props.onBack} aria-label="Back">
              <ChevronLeft />
            </button>
            <h1 className="min-w-0 text-[26px] leading-tight font-black tracking-[-0.02em]">{props.title}</h1>
          </div>
          {props.children}
        </div>
      </div>
      {props.footer && <div className="mx-auto w-full max-w-xl px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{props.footer}</div>}
    </div>
  )
}

/** Backup folders: the backed-up folders, then the rest of the phone's; tapping a backed-up one opens its options. */
function FoldersScreen({ onClose }: { onClose: () => void }) {
  const settings = useBackup((s) => s.settings)
  const chosen = new Map(sourcesOf(settings).map((s) => [s.path, s]))
  const [folders, setFolders] = useState<MediaFolder[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** The folder whose options are open, and whether its older-photos screen is. */
  const [open, setOpen] = useState<string | null>(null)
  const [older, setOlder] = useState<string | null>(null)

  useEffect(() => {
    Native.listMediaFolders().then(
      ({ folders }) => setFolders([...folders].sort((a, b) => Number(b.path === CAMERA_PATH) - Number(a.path === CAMERA_PATH) || b.count - a.count)),
      (e) => setError(e instanceof Error ? e.message : String(e)),
    )
  }, [])

  const info = (path: string) => folders?.find((f) => f.path === path)
  const on = [...chosen.values()]
  const off = (folders ?? []).filter((f) => !chosen.has(f.path))
  const openSource = open ? chosen.get(open) : undefined

  return (
    <Screen title="Backup folders" onBack={onClose} active={!open && !older}>
      <p className="mt-4.5 mb-4 text-sm leading-relaxed text-muted">Switch a folder on to back it up. Tap its name for when and what to back up.</p>
      {error && <p className="mb-4 text-sm font-semibold text-brand-ink">{error}</p>}

      <p className="mb-2.5 text-xs font-extrabold tracking-[0.14em]">ON</p>
      {on.length ? (
        <ul className="panel divide-y-2 divide-line">
          {on.map((s) => (
            <li key={s.path} className="flex items-center gap-3 px-3.5 py-2.5">
              <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setOpen(s.path)}>
                <FolderThumb uri={info(s.path)?.sampleUri} path={s.path} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{label(s.path)}</span>
                  <span className="block truncate text-[13px] text-muted">
                    {info(s.path) ? `${info(s.path)!.count.toLocaleString()} items · ` : ''}
                    <span className="font-bold text-brand-ink">{s.when === 'overnight' ? 'Overnight' : 'As taken'}</span>
                  </span>
                </span>
              </button>
              <Switch label={`Back up ${label(s.path)}`} checked onChange={() => void setSource(s.path, false)} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No folders yet. Switch one on below.</p>
      )}

      <p className="mt-6 mb-2.5 text-xs font-extrabold tracking-[0.14em]">ON THIS PHONE</p>
      {!folders && !error ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" /> Looking for folders…
        </p>
      ) : (
        <ul className="panel divide-y-2 divide-line">
          {off.map((f) => (
            <li key={f.path} className="flex items-center gap-3 px-3.5 py-2.5">
              <FolderThumb uri={f.sampleUri} path={f.path} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold">{label(f.path)}</span>
                <span className="block truncate text-[13px] text-muted">{f.count.toLocaleString()} items</span>
              </span>
              <Switch
                label={`Back up ${label(f.path)}`}
                checked={false}
                onChange={() => {
                  // On with new photos only; its options open so they can be changed straight away
                  void setSource(f.path, true).then(() => setOpen(f.path), toastError)
                }}
              />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3.5 text-[13px] text-muted">Switching one on opens its options: when, and new only or everything.</p>

      {open && openSource && !older && (
        <FolderSheet source={openSource} folder={info(open)} onOlder={() => setOlder(open)} onClose={() => setOpen(null)} />
      )}
      {older && <OlderScreen path={older} onClose={() => setOlder(null)} onDone={() => {
        setOlder(null)
        setOpen(null)
      }} />}
    </Screen>
  )
}

/** A backed-up folder's options: when, what, older photos; Stop backing up / Done. */
function FolderSheet(props: { source: BackupSource; folder?: MediaFolder; onOlder: () => void; onClose: () => void }) {
  const { source, folder, onOlder, onClose } = props
  const wifiOnly = useBackup((s) => s.settings.wifiOnly)
  const tonight = useBackup((s) => s.tonight)
  const name = label(source.path)
  const what = source.since === 0 ? 'all' : source.since === NO_NEW ? 'none' : 'new'
  const kind = source.path === CAMERA_PATH ? 'photos' : isScreenshots(source.path) ? 'screenshots' : 'photos and videos'
  return (
    <Dialog
      title={name}
      subtitle={[folder && `${folder.count.toLocaleString()} items`, source.path.replace(/\/$/, '')].filter(Boolean).join(' · ')}
      icon={folderIcon(source.path)}
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <button
            className="btn-ghost -ml-3 text-brand-ink"
            onClick={() => {
              void setSource(source.path, false)
              onClose()
            }}
          >
            Stop backing up
          </button>
          <button className="btn-primary min-w-28" onClick={onClose}>
            Done
          </button>
        </div>
      }
    >
      <div className="space-y-5.5 pt-2 pb-1 text-sm">
        <div>
          <p className="mb-2.5 text-xs font-extrabold tracking-[0.14em]">WHEN</p>
          <Segmented<BackupWhen>
            label={`When to back up ${name}`}
            value={source.when ?? 'instant'}
            options={[
              { value: 'instant', label: 'As taken' },
              { value: 'overnight', label: 'Overnight' },
            ]}
            onChange={(when) => void setSourceWhen(source.path, when)}
          />
          <p className="mt-2 text-[13px] text-muted">
            {source.when === 'overnight'
              ? `Around 1 AM${wifiOnly ? ', on Wi-Fi' : ''}.${tonight ? ` ${tonight} waiting for tonight.` : ''}`
              : 'Within a few minutes of each one, also while TeleDrive is closed.'}
          </p>
        </div>
        <div>
          <p className="mb-2.5 text-xs font-extrabold tracking-[0.14em]">WHAT</p>
          <Segmented<string>
            label={`What to back up from ${name}`}
            value={what}
            options={[
              { value: 'new', label: 'New only' },
              { value: 'all', label: 'Everything' },
            ]}
            onChange={(v) => void setSourceSince(source.path, v === 'all' ? 0 : Math.floor(Date.now() / 1000))}
          />
          <p className="mt-2 text-[13px] text-muted">
            {what === 'all'
              ? `Everything in ${name}.`
              : what === 'none'
                ? 'No new ones: only the dates below.'
                : `${kind[0].toUpperCase()}${kind.slice(1)} taken since ${day(source.since)}.`}
          </p>
        </div>
        {!!source.ranges?.length && (
          <p className="rounded-md p-3 text-[13px] pressed">
            <b>Older {kind}:</b> {source.ranges.map(rangeLabel).join(', ')} <span className="text-muted">(until they're backed up)</span>
          </p>
        )}
        {what !== 'all' && (
          <button className="flex w-full items-center gap-3 rounded-md p-3.5 text-left raised active:pressed" onClick={onOlder}>
            <History className="size-5 shrink-0 text-brand-ink" />
            <span className="min-w-0 flex-1">
              <span className="block font-bold">Back up older {kind}…</span>
              <span className="block text-[13px] text-muted">Pick dates</span>
            </span>
            <ChevronRight className="size-4.5 shrink-0 text-muted" />
          </button>
        )}
      </div>
    </Dialog>
  )
}

/** Back up older photos: a backed-up folder, two dates, how many that is, Back up. */
function OlderScreen(props: { path: string; onClose: () => void; onDone: () => void }) {
  const sources = useBackup((s) => sourcesOf(s.settings))
  const [path, setPath] = useState(props.path)
  const [days, setDays] = useState<Days>(initialDays)
  const { count, error } = useRangeCount(path, days)
  const valid = validDays(days)
  const today = toDay(new Date())
  const Icon = folderIcon(path)

  const backUp = () => {
    const range = dayRange(days.from, days.to)
    addRange(path, range).then(() => toast(`Backing up ${label(path)} from ${rangeLabel(range)}`), toastError)
    props.onDone()
  }

  return (
    <Screen
      title="Back up older photos"
      onBack={props.onClose}
      footer={
        <button className="btn-primary h-13 w-full text-[15px] font-extrabold" disabled={!valid || !count?.count} onClick={backUp}>
          {count?.count ? `Back up ${count.count.toLocaleString()} item${count.count === 1 ? '' : 's'}` : 'Back up'}
        </button>
      }
    >
      <p className="mt-4 mb-5.5 text-sm leading-relaxed text-muted">
        Upload the photos and videos taken between two dates. New photos keep backing up as usual.
      </p>

      <label className="block">
        <span className="field-label">Folder</span>
        <span className="relative flex h-13 items-center gap-2.5 rounded-md px-3.5 text-[15px] font-semibold pressed">
          <Icon className="size-4.5 shrink-0 text-muted" />
          <span className="flex-1 truncate">{label(path)}</span>
          <ChevronDown className="size-4.5 shrink-0 text-muted" />
          <select aria-label="Folder" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" value={path} onChange={(e) => setPath(e.target.value)}>
            {sources.map((s) => (
              <option key={s.path} value={s.path}>
                {label(s.path)}
              </option>
            ))}
          </select>
        </span>
      </label>

      <div className="mt-4.5 grid grid-cols-2 gap-3">
        <DateField label="From" value={days.from} max={days.to || today} onChange={(from) => setDays((d) => ({ ...d, from }))} />
        <DateField label="To" value={days.to} min={days.from} max={today} onChange={(to) => setDays((d) => ({ ...d, to }))} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2.5">
        {quickRanges().map((q) => (
          <button
            key={q.label}
            className={`h-9 rounded-md px-3.5 text-[13px] font-bold transition-[box-shadow,color] duration-120 ${
              q.from === days.from && q.to === days.to ? 'text-brand-ink pressed' : 'raised-sm active:pressed'
            }`}
            onClick={() => setDays({ from: q.from, to: q.to })}
          >
            {q.label}
          </button>
        ))}
      </div>

      <div className="mt-6.5 flex items-baseline gap-3 rounded-md p-5 raised">
        {!valid ? (
          <p className="text-sm text-muted">Pick a From date on or before the To date, neither in the future.</p>
        ) : error ? (
          <p className="text-sm font-semibold text-brand-ink">{error}</p>
        ) : !count ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Counting…
          </p>
        ) : (
          <>
            <span className="text-[44px] leading-none font-black tracking-[-0.03em]">{count.count.toLocaleString()}</span>
            <span className="min-w-0">
              <span className="block text-[15px] font-bold">
                {count.count === 1 ? 'photo or video' : 'photos and videos'} · {formatBytes(count.bytes)}
              </span>
              <span className="mt-0.5 block text-[13px] text-muted">
                {count.count ? 'Ones already backed up are skipped' : 'Nothing new in these dates'}
              </span>
            </span>
          </>
        )}
      </div>
    </Screen>
  )
}

function FolderThumb({ uri, path }: { uri?: string; path: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const Icon = folderIcon(path)
  useEffect(() => {
    if (!uri) return
    let alive = true
    Native.thumbnail({ uri }).then(({ data }) => alive && data && setSrc(`data:image/jpeg;base64,${data}`), () => {})
    return () => {
      alive = false
    }
  }, [uri])
  return (
    <span className="flex size-10.5 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface raised-xs">
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <Icon className="size-4.5 text-muted" />}
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
          <span className="mt-0.5 block text-[13px] text-muted">Background backup on Xiaomi and others</span>
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

/** A setting with its control (a switch) on the right. */
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

/** A row that opens something (a chevron on the right, a spinner while busy). */
function NavRow(props: { name: string; hint: string; busy?: boolean; onClick: () => void }) {
  return (
    <button className="flex w-full items-center gap-3 px-4 py-4 text-left sm:px-5" disabled={props.busy} onClick={props.onClick}>
      <span className="min-w-0 flex-1">
        <span className="block font-bold">{props.name}</span>
        <span className="mt-0.5 block truncate text-[13px] text-muted">{props.hint}</span>
      </span>
      {props.busy ? <Loader2 className="size-4.5 shrink-0 animate-spin text-muted" /> : <ChevronRight className="size-4.5 shrink-0 text-muted" />}
    </button>
  )
}
