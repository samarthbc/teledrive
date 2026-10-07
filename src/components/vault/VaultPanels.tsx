import { Copy, Download, KeyRound, LifeBuoy, RefreshCw, Trash2, Upload } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { CLIPBOARD_CHOICES, setSetting, useSettings, VAULT_LOCK_CHOICES } from '../../lib/settings'
import { Row, Section } from '../../pages/Settings'
import { copySecret } from '../../vault/clipboard'
import {
  DEFAULT_PASSPHRASE, DEFAULT_PASSWORD, generatePassphrase, generatePassword, MAX_LENGTH, MIN_LENGTH, type PassphraseOptions, type PasswordOptions,
} from '../../vault/generator'
import { Checkbox, Segmented, Toggle } from '../ui'
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
          <button type="button" className="icon-btn" onClick={() => void make()} aria-label="Generate another" title="Generate another">
            <RefreshCw />
          </button>
          <button type="button" className="icon-btn" onClick={() => void copySecret(value, mode === 'password' ? 'Password' : 'Passphrase')} aria-label="Copy" title="Copy">
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
                <button type="button" className="icon-btn-flat" onClick={() => void copySecret(h.value, 'Password')} aria-label="Copy">
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
