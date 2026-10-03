import { Loader2, Lock, LogOut, Monitor, RefreshCw, Smartphone } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import CameraBackupSettings from '../components/CameraBackupSettings'
import ConfirmDialog from '../components/dialogs/ConfirmDialog'
import { Segmented, Toggle } from '../components/ui'
import { setRememberOnDevice } from '../drive/vault'
import { formatDate } from '../lib/format'
import { APP_VERSION } from '../lib/releases'
import { AUTO_LOCK_CHOICES, setSetting, useSettings } from '../lib/settings'
import { setThemeMode, useTheme, type ThemeMode } from '../lib/theme'
import { checkForUpdates, updateNow, useUpdate, type CheckResult } from '../lib/updates'
import { isAndroid } from '../native/android'
import { isDesktop } from '../native/desktop'
import { useDrive, useInPhotos } from '../store/useDrive'
import { toast } from '../store/useToast'
import { describeError } from '../telegram/auth'
import { sessions, type Session } from '../telegram/sessions'

/** Settings (IMPLEMENTATION.md Phase 10): per device, shown in the drive page's main area. */
export default function SettingsView({ onGetApps, cameraBackup }: { onGetApps?: () => void; cameraBackup?: boolean }) {
  const settings = useSettings()
  const themeMode = useTheme((t) => t.mode)
  const anyUnlocked = useDrive((s) => [...s.drive.items.values()].some((i) => i.lock && !i.locked))
  const lockNow = useDrive((s) => s.lockNow)
  const inPhotos = useInPhotos()

  return (
    // Full width; on very wide screens two columns (appearance, security and about | sessions). The columns can't
    // grow past the screen (long, truncated texts would otherwise widen them)
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 pb-6 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-8">
        {/* Camera backup belongs to TelePhotos: only in its settings */}
        {cameraBackup && inPhotos && (
          <Section title="Camera backup">
            <CameraBackupSettings />
          </Section>
        )}
        <Section title="Appearance">
          <Row name="Theme" hint="System follows your device's light or dark mode.">
            <Segmented<ThemeMode>
              label="Theme"
              value={themeMode}
              onChange={setThemeMode}
              options={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
          </Row>
          <Row name="Density" hint="Compact fits more files on the screen.">
            <Segmented
              label="Density"
              value={settings.density}
              onChange={(v) => setSetting('density', v)}
              options={[
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'compact', label: 'Compact' },
              ]}
            />
          </Row>
          <Row inline name="Thumbnails" hint="Off: file-type icons only, nothing is downloaded for them. Saves data.">
            <Toggle label="Thumbnails" checked={settings.thumbnails} onChange={(v) => setSetting('thumbnails', v)} />
          </Row>
        </Section>

        <Section title="Security">
          <Row name="Auto-lock" hint="Unlocked files and folders lock again after this long without activity.">
            <Segmented
              label="Auto-lock after"
              value={settings.autoLockMinutes}
              onChange={(v) => setSetting('autoLockMinutes', v)}
              options={AUTO_LOCK_CHOICES.map((m) => ({ value: m, label: `${m} min` }))}
            />
          </Row>
          <Row
            inline
            name="Lock TeleDrive when it closes"
            hint="Ask for your TeleDrive password every time TeleDrive starts, instead of remembering it on this device."
          >
            <Toggle
              label="Lock TeleDrive when it closes"
              checked={settings.lockOnClose}
              onChange={(v) => {
                setSetting('lockOnClose', v)
                void setRememberOnDevice(!v)
              }}
            />
          </Row>
          <Row
            name="Lock everything now"
            hint={
              settings.lockOnClose
                ? 'Locks every unlocked file and folder, and asks for your TeleDrive password again.'
                : anyUnlocked
                  ? 'Locks every file and folder you have unlocked.'
                  : 'Nothing is unlocked right now.'
            }
          >
            <button
              className="btn-secondary"
              disabled={!anyUnlocked && !settings.lockOnClose}
              onClick={() => {
                void lockNow()
                if (!settings.lockOnClose) toast('Everything is locked')
              }}
            >
              <Lock /> Lock now
            </button>
          </Row>
        </Section>
        <About onGetApps={onGetApps} />
      </div>

      <ActiveSessions />
    </div>
  )
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 className="label-swiss">{title}</h2>
        {action}
      </div>
      <div className="panel divide-y-2 divide-line">{children}</div>
    </section>
  )
}

/** A setting: name and explanation, its control on the right (below on phones, except small ones like switches). */
function Row(props: { name: string; hint?: React.ReactNode; inline?: boolean; children?: React.ReactNode }) {
  const { name, hint, inline, children } = props
  return (
    <div
      className={`flex gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-5 ${
        inline ? 'flex-row items-center justify-between' : 'flex-col'
      }`}
    >
      <div className="min-w-0">
        <p className="font-bold">{name}</p>
        {hint && <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

function ActiveSessions() {
  const [list, setList] = useState<Session[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirm, setConfirm] = useState<Session | 'others' | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setList(await sessions.list())
    } catch (e) {
      setError(describeError(e))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => void load(), [load])

  const others = list?.filter((s) => !s.current).length ?? 0
  // Telegram's errors (e.g. the 24-hour rule) as plain sentences in the dialog
  const run = (fn: () => Promise<void>) => async () => {
    try {
      await fn()
    } catch (e) {
      throw new Error(describeError(e))
    }
    toast(confirm === 'others' ? 'Other devices logged out' : 'Device logged out')
    await load()
  }

  return (
    <Section
      title="Active sessions"
      action={
        <button className="-my-2 icon-btn-flat" onClick={() => void load()} aria-label="Refresh sessions" title="Refresh">
          <RefreshCw className={loading ? 'animate-spin' : ''} />
        </button>
      }
    >
      <p className="px-4 py-3.5 text-[13px] leading-relaxed text-muted sm:px-5">
        Every device logged in to your Telegram account, including Telegram's own apps.
      </p>
      {error && (
        <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-5">
          <p className="text-[13px] font-semibold text-brand-ink">{error}</p>
          <button className="btn-secondary" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}
      {!list && !error && (
        <div className="flex items-center gap-2 px-4 py-5 text-sm text-muted sm:px-5">
          <Loader2 className="size-4 animate-spin" /> Loading sessions…
        </div>
      )}
      {list?.map((s) => {
        const Icon = /android|ios|iphone|ipad|mobile/i.test(s.device) ? Smartphone : Monitor
        return (
          <div key={s.hash} className="flex items-center gap-3.5 px-4 py-3.5 sm:px-5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface raised-xs">
              <Icon className="size-5" strokeWidth={1.8} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-bold">
                <span className="truncate">{s.app || 'Unknown app'}</span>
                {s.current && <span className="shrink-0 text-[11px] font-extrabold tracking-[0.08em] text-brand-ink">THIS DEVICE</span>}
              </p>
              <p className="truncate text-[13px] text-muted">{s.device}</p>
              <p className="truncate text-xs text-muted">
                {[s.place, s.current ? 'Active now' : `Last active ${formatDate(s.lastActive)}`].filter(Boolean).join(' · ')}
              </p>
            </div>
            {!s.current && (
              <button className="btn-ghost h-9 px-2.5 text-[13px] sm:px-3" onClick={() => setConfirm(s)} aria-label={`Log out ${s.app}`}>
                <LogOut /> <span className="hidden sm:inline">Log out</span>
              </button>
            )}
          </div>
        )
      })}
      {others > 1 && (
        <div className="flex justify-end px-4 py-3.5 sm:px-5">
          <button className="btn-danger" onClick={() => setConfirm('others')}>
            <LogOut /> Log out all other devices
          </button>
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm === 'others' ? 'Log out all other devices?' : `Log out ${confirm.app || 'this session'}?`}
          message={
            confirm === 'others'
              ? `${others} other device${others === 1 ? '' : 's'} will be logged out of your Telegram account, including Telegram apps on your phone or computer. You'll need to log in on them again.`
              : `${confirm.device || 'This device'} will be logged out of your Telegram account and will need to log in again.`
          }
          confirmLabel="Log out"
          danger
          icon={LogOut}
          onConfirm={run(confirm === 'others' ? sessions.endOthers : () => sessions.end(confirm.hash))}
          onClose={() => setConfirm(null)}
        />
      )}
    </Section>
  )
}

function About({ onGetApps }: { onGetApps?: () => void }) {
  const update = useUpdate()
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState<CheckResult | null>(null)
  const where = isDesktop ? 'Windows app' : isAndroid ? 'Android app' : 'Website'

  const check = async () => {
    setChecking(true)
    try {
      setChecked(await checkForUpdates())
    } finally {
      setChecking(false)
    }
  }

  // What the latest check found, or what the app is doing with an update
  let status: React.ReactNode = null
  if (update.status === 'downloading') status = `Downloading ${update.version}${update.progress >= 0 ? ` · ${update.progress}%` : '…'}`
  else if (update.status === 'ready')
    status = isDesktop ? `Version ${update.version} is ready. It installs when you close TeleDrive.` : `Version ${update.version} is downloaded.`
  else if (update.status === 'available') status = `Version ${update.version} is available.`
  else if (update.status === 'needsPermission') status = 'Allow TeleDrive to install updates in the settings that opened, then tap Install.'
  else if (update.status === 'error') status = `The update failed: ${update.error}`
  else if (checked?.result === 'offline') status = "Couldn't reach GitHub. Check your connection and try again."
  else if (checked && !isDesktop && !isAndroid)
    status = checked.latest ? `The website updates by itself. The latest app version is ${checked.latest}.` : 'The website updates by itself.'
  else if (checked) status = "You're up to date."

  const action =
    update.status === 'available' || update.status === 'ready' || update.status === 'needsPermission' || update.status === 'error' ? (
      <button className="btn-primary" onClick={() => void updateNow()}>
        {update.status === 'ready' ? (isDesktop ? 'Restart to update' : 'Install') : update.status === 'error' ? 'Try again' : 'Update'}
      </button>
    ) : (
      <button className="btn-secondary" onClick={() => void check()} disabled={checking || update.status === 'downloading'}>
        {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />} Check for updates
      </button>
    )

  return (
    <Section title="About">
      <Row name={`TeleDrive ${APP_VERSION}`} hint={status ?? where}>
        {action}
      </Row>
      {onGetApps && (
        <Row name="Get the app" hint="TeleDrive for Windows and Android, with automatic updates.">
          <button className="btn-secondary" onClick={onGetApps}>
            Download
          </button>
        </Row>
      )}
    </Section>
  )
}
