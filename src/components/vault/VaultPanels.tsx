import { Copy, KeyRound, LifeBuoy, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { CLIPBOARD_CHOICES, setSetting, useSettings, VAULT_LOCK_CHOICES } from '../../lib/settings'
import { Row, Section } from '../../pages/Settings'
import { copySecret } from '../../vault/clipboard'
import {
  DEFAULT_PASSPHRASE, DEFAULT_PASSWORD, generatePassphrase, generatePassword, MAX_LENGTH, MIN_LENGTH, type PassphraseOptions, type PasswordOptions,
} from '../../vault/generator'
import { Checkbox, Segmented } from '../ui'
import { SecretText, StrengthMeter } from './parts'
import { ChangePasswordDialog, NewCodeDialog, ResetDialog } from './VaultGate'

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

  const check = (key: keyof Omit<PasswordOptions, 'length'>, label: string) => (
    <Checkbox checked={pw[key]} onChange={(v) => setPw({ ...pw, [key]: v })}>
      <span className="font-semibold">{label}</span>
    </Checkbox>
  )

  return (
    <div className="space-y-6">
      <Segmented
        label="Kind"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'password', label: 'Password' },
          { value: 'passphrase', label: 'Passphrase' },
        ]}
      />
      <div>
        <div className="well flex items-center gap-3 p-5">
          <SecretText value={value} className="min-w-0 flex-1 text-[22px] leading-snug font-bold" />
          <button className="icon-btn" onClick={() => void make()} aria-label="Generate another" title="Generate another">
            <RefreshCw />
          </button>
          <button className="icon-btn" onClick={() => void copySecret(value, mode === 'password' ? 'Password' : 'Passphrase')} aria-label="Copy" title="Copy">
            <Copy />
          </button>
        </div>
        <StrengthMeter password={value} />
      </div>
      <div className="panel divide-y-2 divide-line px-5">
        {mode === 'password' ? (
          <>
            <Slider label="Length" value={pw.length} min={MIN_LENGTH} max={MAX_LENGTH} onChange={(length) => setPw({ ...pw, length })} />
            <div className="grid gap-x-6 gap-y-3 py-4 sm:grid-cols-2">
              {check('upper', 'A–Z')}
              {check('lower', 'a–z')}
              {check('digits', '0–9')}
              {check('symbols', '! @ # $ %')}
              {check('avoidAmbiguous', 'Avoid look-alikes (l 1 I O 0)')}
            </div>
          </>
        ) : (
          <>
            <Slider label="Words" value={pp.words} min={3} max={10} onChange={(words) => setPp({ ...pp, words })} />
            <div className="flex flex-wrap items-center gap-4 py-4">
              <span className="w-24 text-sm font-bold">Separator</span>
              <Segmented
                small
                label="Separator"
                value={pp.separator}
                onChange={(separator) => setPp({ ...pp, separator })}
                options={['-', '.', '_', ' '].map((s) => ({ value: s, label: s === ' ' ? 'Space' : s }))}
              />
            </div>
            <div className="grid gap-x-6 gap-y-3 py-4 sm:grid-cols-2">
              <Checkbox checked={pp.capitalize} onChange={(capitalize) => setPp({ ...pp, capitalize })}>
                <span className="font-semibold">Capitalize words</span>
              </Checkbox>
              <Checkbox checked={pp.number} onChange={(number) => setPp({ ...pp, number })}>
                <span className="font-semibold">Include a number</span>
              </Checkbox>
            </div>
          </>
        )}
        <p className="py-4 text-xs text-muted">
          Made on this device with its secure random generator. Nothing is sent anywhere.
          {mode === 'passphrase' && ' Words come from the EFF list of 7,776.'}
        </p>
      </div>
      {history.length > 1 && (
        <section>
          <h2 className="label-swiss mb-3">History</h2>
          <div className="panel divide-y-2 divide-line px-5">
            {history.slice(1).map((h, i) => (
              <div key={i} className="flex items-center gap-3 py-3">
                <SecretText value={h.value} className="min-w-0 flex-1 text-sm" />
                <span className="shrink-0 text-xs text-muted">{new Date(h.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                <button className="icon-btn-flat" onClick={() => void copySecret(h.value, 'Password')} aria-label="Copy">
                  <Copy />
                </button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">Kept only until TeleDrive closes.</p>
        </section>
      )}
    </div>
  )
}

function Slider(props: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const { label, value, min, max, onChange } = props
  return (
    <label className="flex items-center gap-4 py-4">
      <span className="w-24 text-sm font-bold">{label}</span>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(+e.target.value)} className="min-w-0 flex-1 accent-brand" />
      <span className="w-10 text-right text-xl font-black tabular-nums">{value}</span>
    </label>
  )
}

/** Settings → TeleWarden (only while TeleWarden is open). */
export function VaultSettings() {
  const settings = useSettings()
  const [dialog, setDialog] = useState<'password' | 'code' | 'reset' | null>(null)
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
        <Row name="Master password" hint="Change it any time. Nothing is re-encrypted, and your recovery code keeps working.">
          <button className="btn-secondary" onClick={() => setDialog('password')}>
            <KeyRound /> Change
          </button>
        </Row>
        <Row name="Recovery code" hint="Make a new code if the old one may have been seen. The old one stops working.">
          <button className="btn-secondary" onClick={() => setDialog('code')}>
            <LifeBuoy /> New code
          </button>
        </Row>
        <Row name="Reset TeleWarden" hint="Only if you’ve lost both your master password and your recovery code. Deletes every item. Your files and photos aren’t touched.">
          <button className="btn-danger" onClick={() => setDialog('reset')}>
            <Trash2 /> Reset
          </button>
        </Row>
      </Section>
      {dialog === 'password' && <ChangePasswordDialog onClose={() => setDialog(null)} />}
      {dialog === 'code' && <NewCodeDialog onClose={() => setDialog(null)} />}
      {dialog === 'reset' && <ResetDialog onClose={() => setDialog(null)} />}
    </>
  )
}
