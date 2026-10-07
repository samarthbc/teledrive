import { ArrowRight, KeyRound, LifeBuoy, Lightbulb, Loader2, Lock, LockKeyhole, LockOpen, MonitorSmartphone, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { WrongPasswordError } from '../../drive/crypto'
import { useVault } from '../../store/useVault'
import { toast } from '../../store/useToast'
import { WrongCodeError } from '../../vault/vaultCrypto'
import Dialog from '../Dialog'
import { ErrorText, PasswordField } from '../ui'
import { MasterPasswordFields, NoRecoveryNote, RecoveryCodeView, TextField, type MasterValue } from './parts'

const message = (e: unknown) =>
  e instanceof WrongPasswordError ? 'Wrong master password' : e instanceof WrongCodeError ? e.message : e instanceof Error ? e.message : String(e)

/** The big wordmark beside the setup card (stacked on phones). */
function Wordmark() {
  return (
    <div>
      <h1 className="border-b-[3px] border-ink pb-4 text-[56px] leading-[0.88] font-black tracking-[-0.055em] md:text-[84px]">
        Tele
        <br />
        Warden<span className="text-brand">.</span>
      </h1>
      <p className="mt-4 max-w-[34ch] text-[17px] font-semibold">Your passwords, cards and notes, kept in your Telegram next to your files and photos.</p>
    </div>
  )
}

function Point({ icon: Icon, title, children }: { icon: typeof Lock; title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3.5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface raised-sm">
        <Icon className="size-[19px]" />
      </span>
      <div>
        <p className="text-[15px] font-bold">{title}</p>
        <p className="mt-0.5 text-[13px] text-muted">{children}</p>
      </div>
    </div>
  )
}

/** First time: welcome → master password → recovery code. */
export function VaultSetup() {
  const create = useVault((s) => s.create)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [master, setMaster] = useState<MasterValue>({ password: '', repeat: '', valid: false })
  const [hint, setHint] = useState('')
  const [code, setCode] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hintProblem = hint && master.password && hint.toLowerCase().includes(master.password.toLowerCase()) ? 'Don’t put the password in the hint' : undefined

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      setCode(await create(master.password, hint))
      setStep(3)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-[980px] items-center gap-8 py-4 md:grid-cols-2 md:gap-12">
      <Wordmark />
      <div className="space-y-5 rounded-md bg-surface p-5 raised-xl md:p-7">
        {step === 1 && (
          <>
            <Point icon={LockKeyhole} title="Encrypted on this device">
              Telegram only ever stores scrambled data. Nobody else can read it.
            </Point>
            <Point icon={KeyRound} title="Its own master password">
              Never stored anywhere, not even on this device. Only you know it, so knowing your TeleDrive password isn’t enough.
            </Point>
            <Point icon={MonitorSmartphone} title="On every device">
              Website, Windows and Android stay in sync.
            </Point>
            <button className="btn-primary w-full" onClick={() => setStep(2)}>
              Create a master password <ArrowRight />
            </button>
          </>
        )}
        {step === 2 && (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault()
              if (master.valid && !hintProblem) void submit()
            }}
          >
            <div>
              <p className="label-swiss text-brand-ink">Step 1 of 2</p>
              <h2 className="mt-2 text-[22px] font-black tracking-[-0.02em]">Create a master password</h2>
            </div>
            <MasterPasswordFields onChange={setMaster} autoFocus />
            <TextField label="Hint (optional)" value={hint} onChange={setHint} placeholder="Something only you would understand" hint="Encrypted, shown only on your devices." error={hintProblem} />
            <NoRecoveryNote />
            {error && <ErrorText>{error}</ErrorText>}
            <button className="btn-primary w-full" type="submit" disabled={!master.valid || !!hintProblem || busy}>
              {busy ? <Loader2 className="animate-spin" /> : null} Next
            </button>
          </form>
        )}
        {step === 3 && (
          <>
            <div>
              <p className="label-swiss text-brand-ink">Step 2 of 2</p>
              <h2 className="mt-2 text-[22px] font-black tracking-[-0.02em]">Save your recovery code</h2>
            </div>
            <RecoveryCodeView code={code} saved={saved} onSaved={setSaved} />
            <button
              className="btn-primary w-full"
              disabled={!saved}
              onClick={() => {
                useVault.setState({ pendingCode: null })
                toast('TeleWarden is ready')
              }}
            >
              Open TeleWarden
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/** Locked: the master password, the hint, the recovery code. */
export function VaultLock() {
  const unlock = useVault((s) => s.unlock)
  const waitUntil = useVault((s) => s.waitUntil)
  const tries = useVault((s) => s.tries)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null | undefined>(undefined)
  const [now, setNow] = useState(Date.now())
  const [dialog, setDialog] = useState<'recover' | 'reset' | null>(null)
  const wait = Math.max(0, Math.ceil((waitUntil - now) / 1000))

  useEffect(() => {
    if (waitUntil <= Date.now()) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [waitUntil])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password || wait) return
    setBusy(true)
    setError(null)
    try {
      await unlock(password)
    } catch (err) {
      const left = 5 - useVault.getState().tries
      setError(err instanceof WrongPasswordError ? `Wrong master password${left > 0 ? ` · ${left} ${left === 1 ? 'try' : 'tries'} before a wait` : ''}` : message(err))
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[400px] flex-col items-center gap-4 py-6 text-center">
      <span className="flex size-21 items-center justify-center rounded-md text-brand-ink pressed-lg">
        <Lock className="size-9" />
      </span>
      <h1 className="text-[40px] leading-none font-black tracking-[-0.04em]">TeleWarden is locked</h1>
      <p className="text-muted">Enter your master password.</p>
      <form className="w-full space-y-3 text-left" onSubmit={(e) => void submit(e)}>
        <PasswordField label="Master password" value={password} onChange={setPassword} icon={KeyRound} autoFocus autoComplete="current-password" error={!!error} />
        {wait > 0 ? <ErrorText>Too many wrong tries. Try again in {wait} s</ErrorText> : error && <ErrorText>{error}</ErrorText>}
        {hint !== undefined && <p className="text-xs text-muted">Hint: {hint ?? 'No hint was set'}</p>}
        <button className="btn-primary w-full" type="submit" disabled={busy || wait > 0 || !password}>
          {busy ? <Loader2 className="animate-spin" /> : <LockOpen />} {busy ? 'Opening…' : 'Unlock'}
        </button>
        <div className="flex flex-wrap justify-between gap-2">
          <button
            type="button"
            className="btn-ghost -ml-2 h-9 px-2"
            onClick={() => (hint === undefined ? void useVault.getState().readHint().then(setHint) : setHint(undefined))}
          >
            <Lightbulb /> {hint === undefined ? 'Show hint' : 'Hide hint'}
          </button>
          <button type="button" className="btn-ghost -mr-2 h-9 px-2" onClick={() => setDialog('recover')}>
            <LifeBuoy /> Forgot it? Use recovery code
          </button>
        </div>
      </form>
      {tries > 0 && tries < 5 && !error && <p className="text-xs text-muted">{tries} wrong {tries === 1 ? 'try' : 'tries'} so far</p>}
      {dialog === 'recover' && <RecoverDialog onClose={() => setDialog(null)} onReset={() => setDialog('reset')} />}
      {dialog === 'reset' && <ResetDialog onClose={() => setDialog(null)} />}
    </div>
  )
}

/** Recovery code → new master password → new recovery code. */
export function RecoverDialog({ onClose, onReset }: { onClose: () => void; onReset: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [code, setCode] = useState('')
  const [master, setMaster] = useState<MasterValue>({ password: '', repeat: '', valid: false })
  const [newCode, setNewCode] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  const footer =
    step === 1 ? (
      <>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button
          className="btn-primary"
          disabled={busy || !code.trim()}
          onClick={() =>
            void run(async () => {
              if (!(await useVault.getState().checkCode(code))) throw new WrongCodeError()
              setStep(2)
            })
          }
        >
          {busy && <Loader2 className="animate-spin" />} Next
        </button>
      </>
    ) : step === 2 ? (
      <>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button
          className="btn-primary"
          disabled={busy || !master.valid}
          onClick={() =>
            void run(async () => {
              setNewCode(await useVault.getState().recover(code, master.password))
              setStep(3)
            })
          }
        >
          {busy && <Loader2 className="animate-spin" />} Set new password
        </button>
      </>
    ) : (
      <button
        className="btn-primary"
        disabled={!saved}
        onClick={() => {
          useVault.setState({ pendingCode: null })
          toast('New master password and recovery code set')
          onClose()
        }}
      >
        Open TeleWarden
      </button>
    )
  return (
    <Dialog
      title={step === 3 ? 'Your new recovery code' : step === 2 ? 'New master password' : 'Use your recovery code'}
      subtitle={step === 3 ? 'The old code no longer works' : `Step ${step} of 3`}
      icon={step === 2 ? KeyRound : LifeBuoy}
      onClose={step === 3 ? () => {} : onClose}
      footer={footer}
      wide
    >
      <div className="space-y-4 pb-1">
        {step === 1 && (
          <>
            <TextField label="Recovery code" value={code} onChange={setCode} mono autoFocus placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" hint="Dashes, spaces and capitals don’t matter." />
            <button className="btn-ghost -ml-2 h-9 px-2 text-brand-ink" onClick={onReset}>
              Lost the code too? Reset TeleWarden
            </button>
          </>
        )}
        {step === 2 && <MasterPasswordFields label="New master password" onChange={setMaster} autoFocus />}
        {step === 3 && <RecoveryCodeView code={newCode} saved={saved} onSaved={setSaved} />}
        {error && <ErrorText>{error}</ErrorText>}
      </div>
    </Dialog>
  )
}

/** Forgot the password and lost the code: delete the vault (TeleDrive password, then RESET). */
export function ResetDialog({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [word, setWord] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reset = async () => {
    setBusy(true)
    setError(null)
    try {
      await useVault.getState().reset(password)
      toast('TeleWarden was reset')
      onClose()
    } catch (e) {
      setError(e instanceof WrongPasswordError ? 'Wrong TeleDrive password' : message(e))
      setBusy(false)
    }
  }
  return (
    <Dialog
      title="Reset TeleWarden"
      icon={Trash2}
      alert
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-danger-solid" disabled={busy || !password || word !== 'RESET'} onClick={() => void reset()}>
            {busy && <Loader2 className="animate-spin" />} Reset TeleWarden
          </button>
        </>
      }
    >
      <div className="space-y-4 pb-1">
        <p className="text-sm">
          Deletes every item in TeleWarden, on all your devices. This can’t be undone. Your files and photos aren’t touched.
        </p>
        <PasswordField label="TeleDrive password" kind="account" value={password} onChange={setPassword} autoComplete="current-password" autoFocus />
        <TextField label="Type RESET to confirm" value={word} onChange={setWord} />
        {error && <ErrorText>{error}</ErrorText>}
      </div>
    </Dialog>
  )
}

const REMINDED_KEY = 'teledrive.vaultReminded'

/** A week after setting up, once: the vault's creation time when it's due, else null. */
export function reminderDue(config: { ct: number } | null): boolean {
  if (!config || Date.now() / 1000 - config.ct < 7 * 86_400) return false
  try {
    return localStorage.getItem(REMINDED_KEY) !== String(config.ct)
  } catch {
    return false
  }
}

function markReminded(ct: number) {
  try {
    localStorage.setItem(REMINDED_KEY, String(ct))
  } catch {
    // Storage blocked: asked again next time
  }
}

/** "Do you still remember your master password?" (once, a week after setting up). Nothing changes either way. */
export function ReminderDialog({ ct, onClose, onRecover }: { ct: number; onClose: () => void; onRecover: () => void }) {
  const [password, setPassword] = useState('')
  const [result, setResult] = useState<'right' | 'wrong' | null>(null)
  const [busy, setBusy] = useState(false)
  const done = () => {
    markReminded(ct)
    onClose()
  }
  const check = async () => {
    setBusy(true)
    try {
      setResult((await useVault.getState().checkPassword(password)) ? 'right' : 'wrong')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title="Do you still remember your master password?"
      subtitle="A quick check, once. Nothing changes."
      icon={KeyRound}
      onClose={done}
      footer={
        result === 'right' ? (
          <button className="btn-primary" onClick={done}>Done</button>
        ) : (
          <>
            <button className="btn-ghost" onClick={done}>Not now</button>
            <button className="btn-primary" disabled={busy || !password} onClick={() => void check()}>
              {busy && <Loader2 className="animate-spin" />} Check
            </button>
          </>
        )
      }
    >
      <div className="space-y-4 pb-1">
        {result === 'right' ? (
          <p className="text-sm">That’s it. Keep your recovery code somewhere safe too.</p>
        ) : (
          <>
            <PasswordField label="Master password" value={password} onChange={(v) => (setPassword(v), setResult(null))} icon={KeyRound} autoComplete="current-password" autoFocus />
            {result === 'wrong' && (
              <>
                <ErrorText>That’s not it.</ErrorText>
                <p className="text-sm">Set a new one now with your recovery code, so you aren’t locked out later.</p>
                <button className="btn-secondary" onClick={() => (markReminded(ct), onRecover())}>
                  <LifeBuoy /> Use recovery code
                </button>
              </>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}

/** Settings → Change master password. */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [master, setMaster] = useState<MasterValue>({ password: '', repeat: '', valid: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await useVault.getState().changePassword(current, master.password)
      toast('Master password changed')
      onClose()
    } catch (e) {
      setError(message(e))
      setBusy(false)
    }
  }
  return (
    <Dialog
      title="Change master password"
      subtitle="Nothing is re-encrypted. Your recovery code keeps working."
      icon={KeyRound}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || !current || !master.valid} onClick={() => void save()}>
            {busy && <Loader2 className="animate-spin" />} Change master password
          </button>
        </>
      }
    >
      <div className="space-y-5 pb-1">
        <PasswordField label="Current master password" value={current} onChange={setCurrent} icon={KeyRound} autoComplete="current-password" autoFocus />
        <MasterPasswordFields label="New master password" onChange={setMaster} />
        <NoRecoveryNote />
        {error && <ErrorText>{error}</ErrorText>}
      </div>
    </Dialog>
  )
}

/** Settings → New recovery code. */
export function NewCodeDialog({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const make = async () => {
    setBusy(true)
    setError(null)
    try {
      setCode(await useVault.getState().newCode(password))
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={code ? 'Your new recovery code' : 'New recovery code'}
      subtitle="The old one stops working"
      icon={LifeBuoy}
      onClose={code ? () => {} : onClose}
      wide
      footer={
        code ? (
          <button className="btn-primary" disabled={!saved} onClick={() => (toast('New recovery code saved. The old one no longer works.'), onClose())}>
            Done
          </button>
        ) : (
          <>
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={busy || !password} onClick={() => void make()}>
              {busy && <Loader2 className="animate-spin" />} Make a new code
            </button>
          </>
        )
      }
    >
      <div className="space-y-4 pb-1">
        {code ? (
          <RecoveryCodeView code={code} saved={saved} onSaved={setSaved} />
        ) : (
          <PasswordField label="Master password" value={password} onChange={setPassword} icon={KeyRound} autoComplete="current-password" autoFocus />
        )}
        {error && <ErrorText>{error}</ErrorText>}
      </div>
    </Dialog>
  )
}
