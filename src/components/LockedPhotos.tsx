import { Loader2, Lock, LockOpen } from 'lucide-react'
import { useState } from 'react'
import { WrongPasswordError } from '../drive/crypto'
import Dialog from './Dialog'
import { ErrorText, PasswordField } from './ui'

function message(e: unknown): string {
  if (e instanceof WrongPasswordError) return 'Wrong TeleDrive password'
  return e instanceof Error ? e.message : String(e)
}

/** The TeleDrive password form, for Locked photos. */
function PasswordForm(props: { submitLabel: string; locking?: boolean; onSubmit: (password: string) => Promise<void>; autoFocus?: boolean }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError(null)
    try {
      await props.onSubmit(password)
    } catch (err) {
      setError(message(err))
      setBusy(false)
    }
  }

  return (
    <form className="w-full space-y-3" onSubmit={submit}>
      <PasswordField
        label="TeleDrive password"
        kind="account"
        autoFocus={props.autoFocus}
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
        error={!!error}
      />
      {error && <ErrorText>{error}</ErrorText>}
      <button className="btn-primary w-full" disabled={!password || busy}>
        {busy ? <Loader2 className="animate-spin" /> : props.locking ? <Lock /> : <LockOpen />} {props.submitLabel}
      </button>
    </form>
  )
}

/** Locked photos while it's locked: asks for the TeleDrive password in place of the photos. */
export function LockedGate({ onUnlock }: { onUnlock: (password: string) => Promise<void> }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-3.5 rounded-md px-7 py-11 text-center pressed-lg">
      <div className="flex size-18 items-center justify-center rounded-md bg-surface text-brand-ink raised-md">
        <Lock className="size-8" strokeWidth={1.6} />
      </div>
      <p className="text-[22px] font-black tracking-[-0.02em]">Locked photos</p>
      <p className="mb-2 text-sm text-muted">Enter your TeleDrive password to see them.</p>
      <PasswordForm submitLabel="Unlock" onSubmit={onUnlock} autoFocus />
    </div>
  )
}

/**
 * Moving photos to Locked photos while it's locked (or doesn't exist yet): the TeleDrive password first. The first
 * time, it says what Locked photos is and that a forgotten password can't be got around.
 */
export function LockPhotosDialog(props: { count: number; first: boolean; onSubmit: (password: string) => Promise<void>; onClose: () => void }) {
  const { count, first } = props
  return (
    <Dialog title="Move to Locked photos" subtitle={`${count} photo${count === 1 ? '' : 's'}`} icon={Lock} onClose={props.onClose}>
      <div className="space-y-4 pb-2 text-sm">
        <p className="leading-relaxed text-muted">
          {first
            ? 'Locked photos open only with your TeleDrive password. They leave your timeline and albums. If you forget the password, they can’t be recovered.'
            : 'Enter your TeleDrive password to open Locked photos.'}
        </p>
        <PasswordForm submitLabel="Move to Locked photos" locking onSubmit={props.onSubmit} autoFocus />
      </div>
    </Dialog>
  )
}
