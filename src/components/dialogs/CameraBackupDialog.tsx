import { Camera, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { requestMediaPermission, runBackup, updateBackupSettings, useBackup } from '../../native/backup'
import Dialog from '../Dialog'

export default function CameraBackupDialog({ onClose }: { onClose: () => void }) {
  const { settings, status, running, backedUp, lastCheck } = useBackup()
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
      await updateBackupSettings({ enabled: true, since: scope === 'new' ? Math.floor(Date.now() / 1000) : 0 })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="Camera backup" onClose={onClose}>
      <div className="space-y-4 pb-4 text-sm">
        <div className="flex items-start gap-3">
          <Camera className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
          <p className="text-slate-600 dark:text-slate-400">
            New photos and videos from your camera are uploaded to the <b>Camera Backup</b> folder whenever the app is open.
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
            <Toggle
              label="Only on Wi-Fi"
              hint="Don't use mobile data for backups"
              checked={settings.wifiOnly}
              onChange={(wifiOnly) => void updateBackupSettings({ wifiOnly })}
            />
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
