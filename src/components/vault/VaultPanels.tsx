import { Check, ChevronRight, Copy, Download, KeyRound, LifeBuoy, RefreshCw, Trash2, Upload } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { CLIPBOARD_CHOICES, setSetting, useSettings, VAULT_LOCK_CHOICES } from '../../lib/settings'
import { Row, Section } from '../../pages/Settings'
import { copySecret } from '../../vault/clipboard'
import {
  DEFAULT_PASSPHRASE, DEFAULT_PASSWORD, generatePassphrase, generatePassword, MAX_LENGTH, MIN_LENGTH, type PassphraseOptions, type PasswordOptions,
} from '../../vault/generator'
import { Segmented, Toggle } from '../ui'
import { SecretText, StrengthMeter } from './parts'
import { ExportDialog, ImportDialog } from './DataDialogs'
import { ChangePasswordDialog, EnableBioDialog, NewCodeDialog, ResetDialog, SetPinDialog } from './VaultGate'
import { isAndroid, Native } from '../../native/android'
import { isDesktop } from '../../native/desktop'
import { useVault } from '../../store/useVault'

/** Kept while TeleDrive is open (memory only). */
const history: { value: string; at: number }[] = []
let lastMode: 'password' | 'passphrase' = 'password'
let lastPassword: PasswordOptions = DEFAULT_PASSWORD
let lastPassphrase: PassphraseOptions = DEFAULT_PASSPHRASE

export function GeneratorPanel() {
  const [mode, setMode] = useState(lastMode)
  const [pw, setPw] = useState(lastPassword)
  const [pp, setPp] = useState(lastPassphrase)
  const [value, setValue] = useState('')
  const [, redraw] = useState(0)

  const make = useCallback(async () => {
    const v = mode === 'password' ? generatePassword(pw) : await generatePassphrase(pp)
    setValue(v)
    history.unshift({ value: v, at: Date.now() })
    history.splice(8)
    redraw((n) => n + 1)
  }, [mode, pw, pp])

  useEffect(() => {
    lastMode = mode
    lastPassword = pw
    lastPassphrase = pp
    void make()
  }, [mode, pw, pp, make])

  const chip = (on: boolean, label: string, onChange: (v: boolean) => void) => (
    <button type="button" aria-pressed={on} className={on ? 'chip-active' : 'chip'} onClick={() => onChange(!on)}>
      {on && <Check className="size-3.5" strokeWidth={3} />}
      {label}
    </button>
  )
  const pwChip = (key: keyof Omit<PasswordOptions, 'length'>, label: string) =>
    chip(pw[key], label, (v) => {
      const next = { ...pw, [key]: v }
      // At least one kind of character stays on
      if (next.upper || next.lower || next.digits || next.symbols) setPw(next)
    })

  return (
    <div className="mx-auto w-full max-w-[640px]">
      <h1 className="h-display mb-5">Generator</h1>
      <div className="panel space-y-5 p-4 md:p-6">
        <div className="flex">
          <Segmented
            label="Kind"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'password', label: 'Password' },
              { value: 'passphrase', label: 'Passphrase' },
            ]}
          />
        </div>

        <div>
          <div className="rounded-md px-4 py-4 pressed md:px-5">
            <SecretText value={value} className="block min-h-[2lh] text-lg leading-snug font-bold md:text-xl" />
          </div>
          <StrengthMeter password={value} />
        </div>

        <div className="flex gap-2.5">
          <button type="button" className="btn-primary flex-1" onClick={() => void copySecret(value, mode === 'password' ? 'Password' : 'Passphrase')}>
            <Copy /> Copy
          </button>
          <button type="button" className="btn-secondary" onClick={() => void make()} aria-label="Generate another" title="Generate another">
            <RefreshCw /> <span className="hidden sm:inline">New</span>
          </button>
        </div>

        <div className="space-y-4 border-t-2 border-line pt-5">
          {mode === 'password' ? (
            <>
              <Slider label="Length" value={pw.length} min={MIN_LENGTH} max={MAX_LENGTH} onChange={(length) => setPw({ ...pw, length })} />
              <Option label="Include">
                {pwChip('upper', 'A–Z')}
                {pwChip('lower', 'a–z')}
                {pwChip('digits', '0–9')}
                {pwChip('symbols', '!@#$')}
              </Option>
              <Option label="Avoid">{chip(pw.avoidAmbiguous, 'Look-alikes (l 1 I O 0)', (avoidAmbiguous) => setPw({ ...pw, avoidAmbiguous }))}</Option>
            </>
          ) : (
            <>
              <Slider label="Words" value={pp.words} min={3} max={10} onChange={(words) => setPp({ ...pp, words })} />
              <Option label="Separator">
                <Segmented
                  small
                  label="Separator"
                  value={pp.separator}
                  onChange={(separator) => setPp({ ...pp, separator })}
                  options={['-', '.', '_', ' '].map((s) => ({ value: s, label: s === ' ' ? 'Space' : s }))}
                />
              </Option>
              <Option label="Add">
                {chip(pp.capitalize, 'Capitals', (capitalize) => setPp({ ...pp, capitalize }))}
                {chip(pp.number, 'A number', (number) => setPp({ ...pp, number }))}
              </Option>
            </>
          )}
        </div>
        <p className="text-xs text-muted">
          Made on this device with its secure random generator. Nothing is sent anywhere.
          {mode === 'passphrase' && ' Words come from the EFF list of 7,776.'}
        </p>
      </div>

      {history.length > 1 && (
        <details className="group mt-5">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-bold text-muted hover:text-ink">
            <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
            Recently generated ({history.length - 1})
          </summary>
          <div className="panel mt-3 divide-y-2 divide-line px-4">
            {history.slice(1).map((h, i) => (
              <div key={i} className="flex items-center gap-3 py-2.5">
                <SecretText value={h.value} className="min-w-0 flex-1 text-sm" />
                <span className="shrink-0 text-xs text-muted">{new Date(h.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                <button type="button" className="icon-btn-flat" onClick={() => void copySecret(h.value, 'Password')} aria-label="Copy">
                  <Copy />
                </button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">Kept only until TeleDrive closes.</p>
        </details>
      )}
    </div>
  )
}

/** A labelled row of options. */
function Option({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="w-20 shrink-0 text-sm font-bold">{label}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

function Slider(props: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const { label, value, min, max, onChange } = props
  return (
    <label className="flex items-center gap-4">
      <span className="w-20 shrink-0 text-sm font-bold">{label}</span>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(+e.target.value)} className="min-w-0 flex-1 accent-brand" />
      <span className="w-8 text-right text-lg font-black tabular-nums">{value}</span>
    </label>
  )
}

/** Settings → TeleWarden (only while TeleWarden is open). */
export function VaultSettings() {
  const settings = useSettings()
  const [dialog, setDialog] = useState<'password' | 'code' | 'reset' | 'import' | 'export' | 'pin' | 'bio' | null>(null)
  const pinSet = useVault((s) => s.pinSet)
  const bioSet = useVault((s) => s.bioSet)
  const [bio, setBio] = useState<{ available: boolean; enrolled: boolean } | null>(null)
  useEffect(() => {
    if (isAndroid) Native.biometricAvailable().then(setBio, () => setBio({ available: false, enrolled: false }))
  }, [])
  return (
    <>
      <Section title="TeleWarden">
        <Row name="Lock TeleWarden after" hint="Counted from your last tap or key press. Your files keep their own lock.">
          <Segmented
            label="Lock TeleWarden after"
            value={settings.vaultLockMinutes}
            onChange={(v) => setSetting('vaultLockMinutes', v)}
            options={VAULT_LOCK_CHOICES.map((m) => ({ value: m, label: m ? `${m} min` : 'On close' }))}
          />
        </Row>
        <Row name="Clear the clipboard after" hint="Copied passwords and codes are removed from the clipboard.">
          <Segmented
            label="Clear the clipboard after"
            value={settings.clipboardSeconds}
            onChange={(v) => setSetting('clipboardSeconds', v)}
            options={CLIPBOARD_CHOICES.map((s) => ({ value: s, label: !s ? 'Never' : s < 60 ? `${s} s` : `${s / 60} min` }))}
          />
        </Row>
        <Row inline name="Unlock with a PIN" hint="Quicker than the master password. Your master password is asked once after TeleDrive restarts.">
          <Toggle label="Unlock with a PIN" checked={pinSet} onChange={(v) => (v ? setDialog('pin') : useVault.getState().removePin())} />
        </Row>
        {isAndroid && (
          <Row
            inline
            name="Unlock with fingerprint"
            hint={bio && !bio.available ? (bio.enrolled ? 'This phone has no strong fingerprint sensor.' : 'Add a fingerprint in the phone’s settings first.') : 'Your master password is asked once after TeleDrive restarts.'}
          >
            <Toggle label="Unlock with fingerprint" disabled={!bioSet && !bio?.available} checked={bioSet} onChange={(v) => (v ? setDialog('bio') : void useVault.getState().disableBio())} />
          </Row>
        )}
        {(isAndroid || isDesktop) && (
          <Row inline name="Block screenshots" hint="While TeleWarden is open, screenshots, screen recordings and the app switcher show nothing.">
            <Toggle label="Block screenshots" checked={settings.vaultBlockScreenshots} onChange={(v) => setSetting('vaultBlockScreenshots', v)} />
          </Row>
        )}
        <Row inline name="Show 2FA codes in the list" hint="The current code next to each login that has one.">
          <Toggle label="Show 2FA codes in the list" checked={settings.vaultCodesInList} onChange={(v) => setSetting('vaultCodesInList', v)} />
        </Row>
        <Row name="Master password" hint="Change it any time. Nothing is re-encrypted, and your recovery code keeps working.">
          <button type="button" className="btn-secondary" onClick={() => setDialog('password')}>
            <KeyRound /> Change
          </button>
        </Row>
        <Row name="Recovery code" hint="Make a new code if the old one may have been seen. The old one stops working.">
          <button type="button" className="btn-secondary" onClick={() => setDialog('code')}>
            <LifeBuoy /> New code
          </button>
        </Row>
        <Row name="Import passwords" hint="From Bitwarden, Chrome, Edge, Firefox, LastPass, 1Password or KeePass.">
          <button type="button" className="btn-secondary" onClick={() => setDialog('import')}>
            <Download /> Import
          </button>
        </Row>
        <Row name="Export vault" hint="Keep a copy somewhere other than Telegram, or move to another manager.">
          <button type="button" className="btn-secondary" onClick={() => setDialog('export')}>
            <Upload /> Export
          </button>
        </Row>
        <Row name="Reset TeleWarden" hint="Only if you’ve lost both your master password and your recovery code. Deletes every item. Your files and photos aren’t touched.">
          <button type="button" className="btn-danger" onClick={() => setDialog('reset')}>
            <Trash2 /> Reset
          </button>
        </Row>
      </Section>
      {dialog === 'password' && <ChangePasswordDialog onClose={() => setDialog(null)} />}
      {dialog === 'code' && <NewCodeDialog onClose={() => setDialog(null)} />}
      {dialog === 'reset' && <ResetDialog onClose={() => setDialog(null)} />}
      {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} />}
      {dialog === 'pin' && <SetPinDialog onClose={() => setDialog(null)} />}
      {dialog === 'bio' && <EnableBioDialog onClose={() => setDialog(null)} />}
      {dialog === 'export' && <ExportDialog onClose={() => setDialog(null)} />}
    </>
  )
}
