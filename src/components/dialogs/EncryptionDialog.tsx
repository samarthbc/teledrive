import { Loader2, Lock, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { WrongPasswordError } from '../../drive/crypto'
import { useDrive } from '../../store/useDrive'
import { toast } from '../../store/useToast'
import Dialog from '../Dialog'

const MIN_PASSWORD = 8

/**
 * Encryption settings. Depending on the drive: turn encryption on, unlock it on this device, or
 * (when unlocked) change the password / lock again. `onUnlocked` runs after a successful unlock or setup.
 */
export default function EncryptionDialog({ onClose, onUnlocked, reason }: { onClose: () => void; onUnlocked?: () => void; reason?: string }) {
  const configured = useDrive((s) => !!s.drive.encryption)
  const unlocked = useDrive((s) => s.unlocked)
  const done = () => {
    onClose()
    onUnlocked?.()
  }
  if (!configured) return <Setup onClose={onClose} onDone={done} />
  if (!unlocked) return <Unlock onClose={onClose} onDone={done} reason={reason} />
  return <Settings onClose={onClose} />
}

function useSubmit(fn: () => Promise<void>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof WrongPasswordError ? 'Wrong password' : err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }
  return { busy, error, submit }
}

function Setup({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const enable = useDrive((s) => s.enableEncryption)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [remember, setRemember] = useState(true)
  const [understood, setUnderstood] = useState(false)
  const { busy, error, submit } = useSubmit(async () => {
    await enable(password, remember)
    toast('Encryption is on. New uploads will be encrypted.')
    onDone()
  })
  const mismatch = confirm.length > 0 && confirm !== password
  const valid = password.length >= MIN_PASSWORD && password === confirm && understood

  return (
    <Dialog title="Encrypt your files" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-3 pb-4 text-sm">
        <p className="text-slate-600 dark:text-slate-400">
          Files and folders you add from now on are encrypted on your device before they reach Telegram, names included.
          Only someone with this password can open them. Files already in your drive stay as they are.
        </p>
        <input className="input" type="password" autoFocus autoComplete="new-password" placeholder={`Password (at least ${MIN_PASSWORD} characters)`}
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <input className="input" type="password" autoComplete="new-password" placeholder="Repeat password"
          value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {mismatch && <p className="text-red-600">The passwords don't match</p>}
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>Remember on this device (you won't be asked again here)</span>
        </label>
        <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          <input type="checkbox" className="mt-0.5" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
          <span>
            I understand that <b>if I forget this password, my encrypted files are lost</b>. Nobody, not even TeleDrive or Telegram, can
            recover them.
          </span>
        </label>
        {error && <p className="text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy || !valid}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Turn on encryption
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function Unlock({ onClose, onDone, reason }: { onClose: () => void; onDone: () => void; reason?: string }) {
  const unlock = useDrive((s) => s.unlock)
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const { busy, error, submit } = useSubmit(async () => {
    await unlock(password, remember)
    onDone()
  })

  return (
    <Dialog title="Unlock encrypted files" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 pb-4 text-sm">
        <p className="text-slate-600 dark:text-slate-400">{reason ?? 'Enter your encryption password to open encrypted files.'}</p>
        <input className="input" type="password" autoFocus autoComplete="current-password" placeholder="Encryption password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>Remember on this device</span>
        </label>
        {error && <p className="text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy || !password}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            Unlock
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function Settings({ onClose }: { onClose: () => void }) {
  const lock = useDrive((s) => s.lock)
  const changePassword = useDrive((s) => s.changePassword)
  const [changing, setChanging] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const { busy, error, submit } = useSubmit(async () => {
    await changePassword(current, next)
    toast('Encryption password changed')
    onClose()
  })

  return (
    <Dialog title="Encryption" onClose={onClose} wide>
      <div className="space-y-3 pb-4 text-sm">
        <p className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
          <ShieldCheck className="h-5 w-5" /> On, and unlocked on this device
        </p>
        <p className="text-slate-600 dark:text-slate-400">
          New uploads and folders are encrypted. Files uploaded before encryption was turned on are not.
        </p>
        {changing ? (
          <form onSubmit={submit} className="space-y-3">
            <input className="input" type="password" autoFocus autoComplete="current-password" placeholder="Current password"
              value={current} onChange={(e) => setCurrent(e.target.value)} />
            <input className="input" type="password" autoComplete="new-password" placeholder={`New password (at least ${MIN_PASSWORD} characters)`}
              value={next} onChange={(e) => setNext(e.target.value)} />
            <input className="input" type="password" autoComplete="new-password" placeholder="Repeat new password"
              value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            {confirm.length > 0 && confirm !== next && <p className="text-red-600">The passwords don't match</p>}
            {error && <p className="text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setChanging(false)}>
                Cancel
              </button>
              <button className="btn-primary" disabled={busy || !current || next.length < MIN_PASSWORD || next !== confirm}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Change password
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <button className="btn-ghost" onClick={() => setChanging(true)}>
              Change password
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                void lock().then(() => toast('Encrypted files locked on this device'))
                onClose()
              }}
            >
              <Lock className="h-4 w-4" /> Lock
            </button>
          </div>
        )}
      </div>
    </Dialog>
  )
}
