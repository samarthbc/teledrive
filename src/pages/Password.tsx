import { KeyRound, Loader2, LockOpen, LogOut, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { WrongPasswordError } from '../drive/crypto'
import { useDrive } from '../store/useDrive'
import AuthLayout from './AuthLayout'
import { Checkbox, ErrorText, Note, PasswordField } from '../components/ui'

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
      icon={creating ? KeyRound : ShieldCheck}
      title={creating ? 'Create your TeleDrive password' : 'Enter your TeleDrive password'}
      subtitle={
        creating
          ? 'Every file is encrypted with it on your device before it goes to Telegram. Telegram never sees it.'
          : 'Your files are encrypted. Enter your TeleDrive password to open them on this device.'
      }
    >
      <form onSubmit={submit} className="space-y-4 text-sm">
        <PasswordField
          label="TeleDrive password"
          kind="account"
          autoFocus
          autoComplete={creating ? 'new-password' : 'current-password'}
          hint={creating ? `At least ${MIN_PASSWORD} characters. A few unrelated words work well.` : undefined}
          value={password}
          onChange={setPassword}
          error={!!error}
        />
        {creating && (
          <>
            <PasswordField
              label="Repeat it"
              kind="account"
              autoComplete="new-password"
              value={confirm}
              onChange={setConfirm}
              error={confirm.length > 0 && confirm !== password}
            />
            {confirm.length > 0 && confirm !== password && <ErrorText>The passwords don't match</ErrorText>}
            <Note>
              This password <b>can't be changed or recovered</b>. If you forget it, every file in TeleDrive is lost.
            </Note>
            <Checkbox checked={understood} onChange={setUnderstood}>
              I understand, and I'll save it in a password manager.
            </Checkbox>
          </>
        )}
        {!creating && <p className="text-muted">This device will remember it, so you only enter it once here.</p>}
        {error && <ErrorText>{error}</ErrorText>}
        <div className="flex flex-col gap-2.5 pt-1">
          <button className="btn-primary w-full" disabled={busy || !valid}>
            {busy ? <Loader2 className="animate-spin" /> : creating ? <KeyRound /> : <LockOpen />}
            {creating ? 'Create password' : 'Unlock drive'}
          </button>
          <button type="button" className="btn-ghost w-full" onClick={() => void logout()}>
            <LogOut /> Log out
          </button>
        </div>
      </form>
    </AuthLayout>
  )
}
