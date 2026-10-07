import { Check, Dices, Eye, EyeOff, Loader2, Plus, X } from 'lucide-react'
import { useId, useState } from 'react'
import { ConflictError, newVaultId, useVault } from '../../store/useVault'
import { toast, toastError } from '../../store/useToast'
import { generatePassword } from '../../vault/generator'
import {
  blankItem, cardBrand, groupCardNumber, identityProblems, TYPE_NAMES, type CustomField, type IdentityData, type ItemType, type VaultItem,
} from '../../vault/items'
import Dialog from '../Dialog'
import { ErrorText } from '../ui'
import { OtpField } from './Otp'
import { StrengthMeter, TextField, TYPE_ICONS } from './parts'

const PLACEHOLDERS: Record<ItemType, string> = { login: 'e.g. Amazon', card: 'e.g. HDFC Visa', identity: 'e.g. Personal', note: 'e.g. Home Wi-Fi' }

/**
 * New or edit, for every type. `generate`: open with a fresh generated password (Security report → Change password).
 * Saving an edit checks it wasn't changed on another device meanwhile.
 */
export default function ItemForm(props: { type: ItemType; item?: VaultItem; folder?: string; generate?: boolean; onClose: () => void; onSaved?: (item: VaultItem) => void }) {
  const { type, item, onClose, onSaved } = props
  const folders = useVault((s) => s.folders)
  const [draft, setDraft] = useState<VaultItem>(() => {
    const base = item ? structuredClone(item) : { ...blankItem(type, newVaultId()), ...(props.folder && { f: props.folder }) }
    if (props.generate && base.ty === 'login') base.d.p = generatePassword()
    if (base.ty === 'login' && !base.d.urls.length) base.d.urls = [{ u: '' }]
    return base
  })
  const [showPass, setShowPass] = useState(!!props.generate)
  const [busy, setBusy] = useState(false)
  const [nameError, setNameError] = useState(false)
  const [conflict, setConflict] = useState<VaultItem | null | false>(false)
  const Icon = TYPE_ICONS[type]
  const folderId = useId()
  const notesId = useId()

  const set = (patch: Partial<VaultItem>) => setDraft((d) => ({ ...d, ...patch }) as VaultItem)
  const setData = (patch: object) => setDraft((d) => ({ ...d, d: { ...d.d, ...patch } }) as VaultItem)
  const problems = draft.ty === 'identity' ? identityProblems(draft.d) : {}

  const clean = (d: VaultItem): VaultItem => {
    const out = { ...d, n: d.n.trim(), cf: d.cf?.filter((c) => c.k.trim() || c.v) } as VaultItem
    if (!out.cf?.length) delete out.cf
    if (!out.notes?.trim()) delete out.notes
    if (!out.f) delete out.f
    if (out.ty === 'login') out.d = { ...out.d, urls: out.d.urls.map((u) => ({ ...u, u: u.u.trim() })).filter((u) => u.u), otp: out.d.otp?.trim() || undefined }
    if (out.ty === 'card') out.d = { ...out.d, num: out.d.num.replace(/\s/g, '') }
    return out
  }

  const save = async (force = false) => {
    if (!draft.n.trim()) return setNameError(true)
    if (Object.keys(problems).length) return
    setBusy(true)
    try {
      const saved = await useVault.getState().save(clean(draft), item && !force ? item.rd : undefined)
      toast(item ? `Saved “${saved.n}”` : `Added “${saved.n}”`)
      onSaved?.(saved)
      onClose()
    } catch (e) {
      if (e instanceof ConflictError) setConflict(e.theirs)
      else toastError(e)
      setBusy(false)
    }
  }

  const customFields = (
    <div>
      <p className="field-label">Custom fields</p>
      <div className="space-y-2.5">
        {(draft.cf ?? []).map((c, i) => (
          <div key={i} className="flex gap-2">
            <input className="input min-w-0 flex-1" placeholder="Field name" aria-label="Field name" value={c.k} onChange={(e) => updateField(i, { k: e.target.value })} />
            <input
              className="input min-w-0 flex-1"
              placeholder={c.h ? 'Hidden value' : 'Value'}
              aria-label="Field value"
              type={c.h ? 'password' : 'text'}
              value={c.v}
              onChange={(e) => updateField(i, { v: e.target.value })}
            />
            <button className="icon-btn-flat self-center" onClick={() => set({ cf: draft.cf!.filter((_, j) => j !== i) })} aria-label="Remove field">
              <X />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4">
        <button className="btn-ghost -ml-2 h-9 px-2" onClick={() => set({ cf: [...(draft.cf ?? []), { k: '', v: '' }] })}>
          <Plus /> Text field
        </button>
        <button className="btn-ghost h-9 px-2" onClick={() => set({ cf: [...(draft.cf ?? []), { k: '', v: '', h: true }] })}>
          <Plus /> Hidden field
        </button>
      </div>
    </div>
  )
  function updateField(i: number, patch: Partial<CustomField>) {
    set({ cf: draft.cf!.map((c, j) => (j === i ? { ...c, ...patch } : c)) })
  }

  const idField = (key: keyof IdentityData, label: string, extra: Partial<Parameters<typeof TextField>[0]> = {}) =>
    draft.ty === 'identity' && (
      <TextField label={label} value={draft.d[key] ?? ''} onChange={(v) => setData({ [key]: v })} error={problems[key]} {...extra} />
    )

  return (
    <Dialog
      title={item ? `Edit ${TYPE_NAMES[type].one.toLowerCase()}` : `New ${TYPE_NAMES[type].one.toLowerCase()}`}
      subtitle={item?.n}
      icon={Icon}
      wide
      onClose={onClose}
      footer={
        conflict !== false ? (
          <>
            <button className="btn-ghost" onClick={onClose}>Keep theirs</button>
            <button className="btn-primary" onClick={() => void save(true)}>Keep mine</button>
          </>
        ) : (
          <>
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={busy} onClick={() => void save()}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />} Save
            </button>
          </>
        )
      }
    >
      {conflict !== false ? (
        <div className="space-y-3 pb-1">
          <p className="text-[15px] font-bold">{conflict ? 'Changed on another device' : 'Deleted on another device'}</p>
          <p className="text-sm text-muted">
            {conflict
              ? `“${conflict.n}” was saved on another device after you started editing. Keep your version (theirs is replaced), or keep theirs (your changes are dropped).`
              : 'This item was deleted on another device after you started editing. Keep yours to save it again.'}
          </p>
        </div>
      ) : (
        <form className="space-y-4 pb-1" onSubmit={(e) => (e.preventDefault(), void save())}>
          <TextField
            label="Name"
            value={draft.n}
            onChange={(n) => (setNameError(false), set({ n }))}
            placeholder={PLACEHOLDERS[type]}
            autoFocus={!item}
            error={nameError ? 'Give it a name' : undefined}
          />
          {draft.ty === 'login' && (
            <>
              <TextField label="Username or email" value={draft.d.u} onChange={(u) => setData({ u })} />
              <div>
                <TextField
                  label="Password"
                  value={draft.d.p}
                  onChange={(p) => setData({ p })}
                  type={showPass ? 'text' : 'password'}
                  mono={showPass}
                  trailing={
                    <>
                      <button type="button" className="icon-btn-flat" onClick={() => setShowPass(!showPass)} aria-label={showPass ? 'Hide password' : 'Show password'}>
                        {showPass ? <EyeOff /> : <Eye />}
                      </button>
                      <button
                        type="button"
                        className="icon-btn-flat"
                        title="Generate a password"
                        aria-label="Generate a password"
                        onClick={() => {
                          setData({ p: generatePassword() })
                          setShowPass(true)
                        }}
                      >
                        <Dices />
                      </button>
                    </>
                  }
                />
                <StrengthMeter password={draft.d.p} userInputs={[draft.n, draft.d.u]} />
              </div>
              <OtpField value={draft.d.otp ?? ''} onChange={(otp) => setData({ otp })} />
              <div>
                <p className="field-label">Websites</p>
                <div className="space-y-2.5">
                  {draft.d.urls.map((u, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        className="input"
                        placeholder="https://example.com"
                        aria-label={`Website ${i + 1}`}
                        value={u.u}
                        onChange={(e) => setData({ urls: (draft.d as { urls: { u: string }[] }).urls.map((x, j) => (j === i ? { ...x, u: e.target.value } : x)) })}
                      />
                      {draft.d.urls.length > 1 && (
                        <button type="button" className="icon-btn-flat self-center" onClick={() => setData({ urls: (draft.d as { urls: unknown[] }).urls.filter((_, j) => j !== i) })} aria-label="Remove website">
                          <X />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button type="button" className="btn-ghost -ml-2 mt-1 h-9 px-2" onClick={() => setData({ urls: [...(draft.d as { urls: unknown[] }).urls, { u: '' }] })}>
                  <Plus /> Add another website
                </button>
              </div>
            </>
          )}
          {draft.ty === 'card' && (
            <>
              <TextField label="Cardholder name" value={draft.d.h} onChange={(h) => setData({ h })} />
              <TextField
                label={`Number${draft.d.num ? ` · ${cardBrand(draft.d.num)}` : ''}`}
                value={groupCardNumber(draft.d.num)}
                onChange={(v) => setData({ num: v.replace(/\D/g, '').slice(0, 19) })}
                mono
                inputMode="numeric"
                placeholder="1234 5678 9012 3456"
              />
              <div className="grid grid-cols-2 gap-3.5">
                <TextField label="Expiry" value={draft.d.exp} onChange={(v) => setData({ exp: formatExpiry(v) })} placeholder="MM/YY" inputMode="numeric" maxLength={5} mono />
                <TextField label="Security code" value={draft.d.cvv} onChange={(v) => setData({ cvv: v.replace(/\D/g, '').slice(0, 4) })} type="password" inputMode="numeric" mono />
              </div>
            </>
          )}
          {draft.ty === 'identity' && (
            <>
              <div className="grid grid-cols-[5.5rem_1fr] gap-3.5">
                {idField('ti', 'Title', { placeholder: 'Mr / Ms' })}
                {idField('fn', 'First name')}
              </div>
              <div className="grid grid-cols-2 gap-3.5">
                {idField('mn', 'Middle name')}
                {idField('ln', 'Last name')}
              </div>
              {idField('em', 'Email', { type: 'email' })}
              {idField('ph', 'Phone', { type: 'tel', placeholder: '+91 98450 12345' })}
              {idField('a1', 'Address')}
              {idField('a2', 'Address line 2')}
              <div className="grid grid-cols-2 gap-3.5">
                {idField('city', 'City')}
                {idField('st', 'State')}
                {idField('pin', 'PIN code', { inputMode: 'numeric', maxLength: 6 })}
                {idField('ctry', 'Country')}
              </div>
              <p className="label-swiss pt-1">Documents</p>
              {idField('aad', 'Aadhaar', { inputMode: 'numeric', mono: true, placeholder: '1234 5678 9012' })}
              <div className="grid grid-cols-2 gap-3.5">
                {idField('pan', 'PAN', { mono: true, placeholder: 'ABCDE1234F' })}
                {idField('pp', 'Passport', { mono: true })}
                {idField('dl', 'Driving licence', { mono: true })}
                {idField('vid', 'Voter ID', { mono: true })}
              </div>
              <div className="grid grid-cols-2 gap-3.5">
                {idField('un', 'Username')}
                {idField('co', 'Company')}
              </div>
            </>
          )}
          {draft.ty === 'note' && (
            <div>
              <label className="field-label" htmlFor={notesId}>Note</label>
              <textarea id={notesId} className="input h-auto min-h-40 py-3" value={draft.d.t} onChange={(e) => setData({ t: e.target.value })} />
            </div>
          )}
          <div>
            <label className="field-label" htmlFor={folderId}>Folder</label>
            <select id={folderId} className="input cursor-pointer" value={draft.f ?? ''} onChange={(e) => set({ f: e.target.value || undefined })}>
              <option value="">No folder</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.n}</option>
              ))}
            </select>
          </div>
          {draft.ty !== 'note' && (
            <div>
              <label className="field-label" htmlFor={notesId}>Notes</label>
              <textarea id={notesId} className="input h-auto min-h-20 py-3" value={draft.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
            </div>
          )}
          {customFields}
          {Object.keys(problems).length > 0 && <ErrorText>Fix the fields marked in red first.</ErrorText>}
          <button type="submit" hidden />
        </form>
      )}
    </Dialog>
  )
}

/** "0829" → "08/29" while typing. */
function formatExpiry(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 4)
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d
}
