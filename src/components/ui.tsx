import { Check, Eye, EyeOff, Lock, ShieldCheck, TriangleAlert, type LucideIcon } from 'lucide-react'
import { useId, useState } from 'react'

// Shared Soft Swiss form controls (DESIGN.md §7)

/** A password input with a label, an icon and a show/hide button. */
export function PasswordField(props: {
  label: string
  value: string
  onChange: (v: string) => void
  /** The TeleDrive password (shield) or an item's own password (lock). */
  kind?: 'account' | 'item'
  autoFocus?: boolean
  autoComplete: string
  placeholder?: string
  hint?: string
  error?: boolean
  /** Instead of the shield/lock (e.g. a key for the api_hash). */
  icon?: LucideIcon
  /** Monospace text (codes and keys). */
  mono?: boolean
  onPaste?: React.ClipboardEventHandler<HTMLInputElement>
}) {
  const { label, value, onChange, kind = 'item', autoFocus, autoComplete, placeholder, hint, error, mono, onPaste } = props
  const id = useId()
  const [shown, setShown] = useState(false)
  const Icon = props.icon ?? (kind === 'account' ? ShieldCheck : Lock)
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <Icon className="pointer-events-none absolute top-1/2 left-3.5 size-[17px] -translate-y-1/2 text-muted" />
        <input
          id={id}
          className={`input pr-12 pl-10.5 ${mono && shown ? 'font-mono' : ''} ${error ? 'input-error' : ''}`}
          type={shown ? 'text' : 'password'}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={onPaste}
          spellCheck={false}
          aria-invalid={error || undefined}
        />
        <button
          type="button"
          className="absolute top-1/2 right-1 -translate-y-1/2 icon-btn-flat"
          onClick={() => setShown(!shown)}
          aria-label={`${shown ? 'Hide' : 'Show'} ${label}`}
        >
          {shown ? <EyeOff /> : <Eye />}
        </button>
      </div>
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  )
}

/** One option of a choice (radio) list, as a raised card that presses in when chosen. */
export function Choice(props: { label: string; hint?: string; checked: boolean; onChange: () => void; name: string }) {
  const { label, hint, checked, onChange, name } = props
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-md p-3.5 transition-[box-shadow] duration-120 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand ${
        checked ? 'pressed' : 'raised-sm'
      }`}
    >
      <input type="radio" name={name} className="sr-only" checked={checked} onChange={onChange} />
      <span className="mt-0.5 flex size-5.5 shrink-0 items-center justify-center rounded-full bg-surface pressed-xs">
        {checked && <span className="size-2.5 rounded-full bg-brand" />}
      </span>
      <span className="min-w-0">
        <span className={`block text-sm ${checked ? 'font-extrabold text-brand-ink' : 'font-bold'}`}>{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-relaxed text-muted">{hint}</span>}
      </span>
    </label>
  )
}

export function Checkbox(props: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  const { checked, onChange, children } = props
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm has-focus-visible:[&>span:first-of-type]:outline-2 has-focus-visible:[&>span:first-of-type]:outline-offset-2 has-focus-visible:[&>span:first-of-type]:outline-brand">
      <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span
        className={`mt-px flex size-6 shrink-0 items-center justify-center rounded-[5px] transition ${
          checked ? 'bg-brand text-white raised-xs' : 'bg-surface pressed-xs'
        }`}
      >
        {checked && <Check className="size-4" strokeWidth={3} />}
      </span>
      <span className="min-w-0 pt-0.5">{children}</span>
    </label>
  )
}

/** On/off switch. */
export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  const { checked, onChange, label, disabled } = props
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7.5 w-13.5 shrink-0 rounded-full transition-colors duration-150 disabled:opacity-45 ${
        checked ? 'bg-brand shadow-[inset_2px_2px_4px_rgba(0,0,0,0.25)]' : 'bg-surface pressed'
      }`}
    >
      <span
        className={`absolute top-1 size-5.5 rounded-full bg-surface raised-xs transition-[left] duration-150 ${checked ? 'left-7' : 'left-1'}`}
      />
    </button>
  )
}

/**
 * Something to be careful about (e.g. a password that can't be recovered). Flat on the surface with a red rule:
 * pressed-in wells are for things you fill in or that hold a value, and a warning is neither.
 */
export function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3.5 border-l-[3px] border-brand py-1 pl-3.5 text-[13px] leading-relaxed">
      <TriangleAlert className="size-5.5 shrink-0 text-brand-ink" strokeWidth={2} />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-[13px] font-semibold text-brand-ink">
      {children}
    </p>
  )
}

/** Swiss section label: a rule above, uppercase. */
export function SectionLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <p className={`label-swiss ${className}`}>{children}</p>
}

/** A few choices side by side (e.g. Comfortable / Compact): the chosen one raised, in red. */
export function Segmented<T extends string | number>(props: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  /** Smaller, for inside lists. */
  small?: boolean
}) {
  const { label, value, options, onChange, small } = props
  return (
    <div className={`flex max-w-full shrink-0 gap-1 overflow-x-auto rounded-md p-1 pressed ${small ? 'h-9' : 'h-11'}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`min-w-0 flex-auto rounded-md px-1.5 sm:px-3 ${small ? 'text-xs' : 'text-[13px]'} whitespace-nowrap transition-[box-shadow,color] duration-120 sm:flex-none ${
            o.value === value ? 'bg-surface font-extrabold text-brand-ink raised-sm' : 'font-semibold text-muted hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
