import { Check, Copy, CreditCard, Dices, Eye, EyeOff, FileDown, IdCard, KeyRound, StickyNote, TriangleAlert, X, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { pickSaveTarget } from '../../drive/download'
import { verifyPassword } from '../../drive/vault'
import { toast, toastError } from '../../store/useToast'
import { copySecret } from '../../vault/clipboard'
import { generatePassphrase } from '../../vault/generator'
import type { ItemType, VaultItem } from '../../vault/items'
import { masterRules, SCORE_LABELS, useStrength } from '../../vault/strength'
import { Checkbox, Note } from '../ui'

export const TYPE_ICONS: Record<ItemType, LucideIcon> = { login: KeyRound, card: CreditCard, identity: IdCard, note: StickyNote }

/** The item's tile: its first letter for logins, the type's icon otherwise. */
export function ItemTile({ item, large }: { item: Pick<VaultItem, 'ty' | 'n'>; large?: boolean }) {
  const Icon = TYPE_ICONS[item.ty]
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-md bg-surface font-black tracking-[-0.02em] raised-sm ${
        large ? 'size-14 text-2xl' : 'size-11 text-lg'
      }`}
      aria-hidden
    >
      {item.ty === 'login' && item.n.trim() ? item.n.trim()[0].toUpperCase() : <Icon className={large ? 'size-6' : 'size-5'} />}
    </span>
  )
}

/** A password in a monospace face: digits red, symbols muted (no l / 1 / I mix-ups). */
export function SecretText({ value, className = '' }: { value: string; className?: string }) {
  return (
    <span className={`font-mono break-all ${className}`}>
      {[...value].map((ch, i) =>
        /\d/.test(ch) ? (
          <span key={i} className="text-brand-ink">{ch}</span>
        ) : /[A-Za-z]/.test(ch) ? (
          ch
        ) : (
          <span key={i} className="text-muted">{ch}</span>
        ),
      )}
    </span>
  )
}

/** Four bars and a word. */
export function StrengthMeter({ password, userInputs }: { password: string; userInputs?: string[] }) {
  const score = useStrength(password, userInputs)
  const filled = score === null ? 0 : Math.max(1, score)
  const color = score === null ? '' : score <= 1 ? 'bg-brand' : score === 2 ? 'bg-muted' : 'bg-ink'
  return (
    <div className="mt-2 flex items-center gap-1" aria-live="polite">
      {[1, 2, 3, 4].map((n) => (
        <span key={n} className={`h-1.25 flex-1 rounded-full ${n <= filled ? color : 'pressed-xs'}`} />
      ))}
      <span className={`ml-2 w-20 shrink-0 text-xs font-bold ${score !== null && score <= 1 ? 'text-brand-ink' : ''}`}>
        {score === null ? '' : SCORE_LABELS[score]}
      </span>
    </div>
  )
}

/** One field of an item: label, value, show/hide for secrets, copy. */
export function FieldRow(props: {
  label: string
  value: string
  /** Shown instead of the plain value (e.g. a link or coloured password). */
  display?: React.ReactNode
  secret?: boolean
  /** Monospace (passwords, numbers). */
  mono?: boolean
  copy?: boolean
  extra?: React.ReactNode
  actions?: React.ReactNode
}) {
  const { label, value, display, secret, mono, copy = true, extra, actions } = props
  const [shown, setShown] = useState(false)
  if (!value) return null
  return (
    <div className="flex min-h-15.5 items-center gap-2 border-b-2 border-line py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-muted">{label}</p>
        <div className={`text-[15px] font-semibold break-words whitespace-pre-wrap ${mono || secret ? 'font-mono text-[14.5px]' : ''}`}>
          {secret && !shown ? '••••••••••••' : (display ?? value)}
        </div>
        {extra}
      </div>
      <div className="flex shrink-0 gap-0.5">
        {actions}
        {secret && (
          <button type="button" className="icon-btn-flat" onClick={() => setShown(!shown)} aria-label={`${shown ? 'Hide' : 'Show'} ${label}`}>
            {shown ? <EyeOff /> : <Eye />}
          </button>
        )}
        {copy && (
          <button type="button" className="icon-btn-flat" onClick={() => void copySecret(value, label)} aria-label={`Copy ${label}`} title={`Copy ${label}`}>
            <Copy />
          </button>
        )}
      </div>
    </div>
  )
}

/** A labelled text input. */
export function TextField(props: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  mono?: boolean
  error?: string
  hint?: string
  autoFocus?: boolean
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  maxLength?: number
  trailing?: React.ReactNode
}) {
  const { label, value, onChange, placeholder, type = 'text', mono, error, hint, autoFocus, inputMode, maxLength, trailing } = props
  const id = useId()
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          className={`input ${mono ? 'font-mono' : ''} ${error ? 'input-error' : ''} ${trailing ? 'pr-22' : ''}`}
          type={type}
          value={value}
          placeholder={placeholder}
          autoFocus={autoFocus}
          inputMode={inputMode}
          maxLength={maxLength}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error || undefined}
        />
        {trailing && <div className="absolute top-1/2 right-1 flex -translate-y-1/2 gap-0.5">{trailing}</div>}
      </div>
      {error ? <p className="mt-1.5 text-xs font-semibold text-brand-ink">{error}</p> : hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  )
}

export interface MasterValue {
  password: string
  repeat: string
  valid: boolean
}

/**
 * New master password: typed twice, strength meter and the rules as a checklist (12+ characters, rated Strong, not
 * the TeleDrive password, both match). "Suggest a passphrase" fills both and shows it.
 */
export function MasterPasswordFields(props: { label?: string; onChange: (v: MasterValue) => void; autoFocus?: boolean }) {
  const { label = 'Master password', onChange, autoFocus } = props
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [shown, setShown] = useState(false)
  const [notTeleDrive, setNotTeleDrive] = useState<boolean | null>(null)
  const score = useStrength(password)
  const rules = masterRules(password, repeat, score, notTeleDrive)
  const valid = rules.every((r) => r.ok)
  const id = useId()

  // Checking against the TeleDrive password takes a moment (it's PBKDF2): after typing stops
  useEffect(() => {
    setNotTeleDrive(null)
    if (password.length < 8) return
    let stale = false
    const t = setTimeout(() => {
      verifyPassword(password).then(
        (same) => !stale && setNotTeleDrive(!same),
        () => !stale && setNotTeleDrive(true),
      )
    }, 500)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [password])

  useEffect(() => onChange({ password, repeat, valid }), [password, repeat, valid, onChange])

  const suggest = async () => {
    const p = await generatePassphrase({ words: 5, separator: '-', capitalize: true, number: true })
    setPassword(p)
    setRepeat(p)
    setShown(true)
    toast('Suggested a passphrase. Write it down somewhere safe.')
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
        <div className="relative">
          <KeyRound className="pointer-events-none absolute top-1/2 left-3.5 size-[17px] -translate-y-1/2 text-muted" />
          <input
            id={id}
            className={`input pr-12 pl-10.5 ${shown ? 'font-mono' : ''}`}
            type={shown ? 'text' : 'password'}
            autoComplete="new-password"
            autoFocus={autoFocus}
            spellCheck={false}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="button" className="absolute top-1/2 right-1 -translate-y-1/2 icon-btn-flat" onClick={() => setShown(!shown)} aria-label={shown ? 'Hide password' : 'Show password'}>
            {shown ? <EyeOff /> : <Eye />}
          </button>
        </div>
        <StrengthMeter password={password} />
      </div>
      <TextField label="Type it again" value={repeat} onChange={setRepeat} type={shown ? 'text' : 'password'} mono={shown} />
      <ul className="space-y-1" aria-label="Rules">
        {rules.map((r) => (
          <li key={r.label} className={`flex items-center gap-2 text-[13px] ${r.ok ? 'font-semibold' : 'font-bold text-brand-ink'}`}>
            {r.ok ? <Check className="size-4" strokeWidth={2.5} /> : <X className="size-4" strokeWidth={2.5} />}
            {r.label}
          </li>
        ))}
      </ul>
      <button type="button" className="btn-ghost -ml-2 h-9 px-2" onClick={() => void suggest()}>
        <Dices /> Suggest a passphrase
      </button>
    </div>
  )
}

/** The recovery code, shown once: copy, save as a file, and "I've saved it". */
export function RecoveryCodeView({ code, saved, onSaved }: { code: string; saved: boolean; onSaved: (v: boolean) => void }) {
  const saveFile = async () => {
    try {
      const target = await pickSaveTarget({ name: 'TeleWarden recovery code.txt', mime: 'text/plain' })
      if (!target) return
      const text = `TeleWarden recovery code\n\n${code}\n\nIt opens TeleWarden if you forget your master password. Keep it somewhere safe.\n`
      await target.write(new TextEncoder().encode(text))
      await target.close()
      toast('Recovery code saved')
    } catch (e) {
      toastError(e)
    }
  }
  return (
    <div className="space-y-4">
      <p className="text-sm">If you forget your master password, this code is the only way to open TeleWarden. It’s shown once.</p>
      <div className="well px-4 py-5 text-center">
        <span className="font-mono text-[17px] font-bold tracking-[0.04em] break-all select-all">{code}</span>
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-secondary" onClick={() => void copySecret(code, 'Recovery code')}>
          <Copy /> Copy
        </button>
        <button type="button" className="btn-secondary" onClick={() => void saveFile()}>
          <FileDown /> Save as file
        </button>
      </div>
      <p className="text-xs text-muted">Keep it somewhere safe, away from this device: on paper, or in another password manager.</p>
      <Checkbox checked={saved} onChange={onSaved}>
        <span className="font-semibold">I’ve saved my recovery code</span>
      </Checkbox>
    </div>
  )
}

export function NoRecoveryNote() {
  return (
    <Note>
      <b>Nobody can reset this password.</b> Not Telegram, not TeleDrive. Your recovery code is the only way back in.
    </Note>
  )
}

/** A red-ruled warning (an item in the trash, an old version back, a weak password…). */
export function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-l-[3px] border-brand py-1 pl-3.5 text-[13px] leading-relaxed">
      <TriangleAlert className="mt-0.5 size-5 shrink-0 text-brand-ink" strokeWidth={2} />
      <div className="flex min-w-0 flex-col">{children}</div>
    </div>
  )
}
