import { KeyRound, Loader2, LogOut } from 'lucide-react'
import { useState } from 'react'
import { WrongPasswordError } from '../drive/crypto'
import { useDrive } from '../store/useDrive'
import AuthLayout from './AuthLayout'

export const MIN_PASSWORD = 8

/** After Telegram's login: create the TeleDrive password (new account) or enter it (new device). */
export default function PasswordPage() {
  const mode = useDrive((s) => s.passwordMode)
  const submitPassword = useDrive((s) => s.submitPassword)
  const logout = useDrive((s) => s.logout)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const creating = mode === 'create'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await submitPassword(password)
    } catch (err) {
      setError(err instanceof WrongPasswordError ? 'Wrong TeleDrive password' : err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const valid = creating ? password.length >= MIN_PASSWORD && password === confirm && understood : password.length > 0

  return (
    <AuthLayout
      icon={KeyRound}
      title={creating ? 'Create your TeleDrive password' : 'Enter your TeleDrive password'}
      subtitle={
        creating
          ? 'Every file is encrypted with it on your device before it goes to Telegram. Telegram never sees it.'
          : 'Your files are encrypted. Enter your TeleDrive password to open them on this device.'
      }
    >
      <form onSubmit={submit} className="space-y-4 text-sm">
        <input
          className="input" type="password" autoFocus autoComplete={creating ? 'new-password' : 'current-password'}
          placeholder={creating ? `TeleDrive password (at least ${MIN_PASSWORD} characters)` : 'TeleDrive password'}
          value={password} onChange={(e) => setPassword(e.target.value)}
        />
        {creating && (
          <>
            <input
              className="input" type="password" autoComplete="new-password" placeholder="Repeat it"
              value={confirm} onChange={(e) => setConfirm(e.target.value)}
            />
            {confirm.length > 0 && confirm !== password && <p className="text-red-600">The passwords don't match</p>}
            <p className="text-slate-600 dark:text-slate-400">
              Use a long passphrase (a few unrelated words). Save it in a password manager.
            </p>
            <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              <input type="checkbox" className="mt-0.5" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
              <span>
                I understand that this password <b>can't be changed or recovered</b>. If I forget it, every file in TeleDrive is lost.
              </span>
            </label>
          </>
        )}
        {!creating && <p className="text-slate-600 dark:text-slate-400">This device will remember it, so you only enter it once here.</p>}
        {error && <p className="text-red-600">{error}</p>}
        <button className="btn-primary w-full py-2.5" disabled={busy || !valid}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {creating ? 'Create password' : 'Continue'}
        </button>
        <button type="button" className="btn-ghost w-full" onClick={() => void logout()}>
          <LogOut className="h-4 w-4" /> Log out
        </button>
      </form>
    </AuthLayout>
  )
}
