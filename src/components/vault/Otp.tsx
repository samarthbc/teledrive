import { Camera, Check, Copy, Image, Loader2, Plus, RotateCw, ScanQrCode, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { telegramClockOffset } from '../../telegram/client'
import { newVaultId, useVault } from '../../store/useVault'
import { toast, toastError } from '../../store/useToast'
import { copySecret } from '../../vault/clipboard'
import { parseMigration, type MigrationBatch } from '../../vault/googleAuth'
import { blankItem, byName, type LoginItem, type VaultItem } from '../../vault/items'
import { matchLogins } from '../../vault/otpMatch'
import { canScanWithCamera, pastedImage, readQrFromImage, scanWithCamera } from '../../vault/qr'
import { base32Encode, currentCode, groupCode, parseOtp, toOtpauth, type OtpParams } from '../../vault/totp'
import Dialog from '../Dialog'
import { ErrorText } from '../ui'
import { ItemTile, TextField } from './parts'

// ---- one clock for every code on screen ----

const ticks = new Set<() => void>()
let ticker: ReturnType<typeof setInterval> | undefined
function useSecond(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const fn = () => setNow(Date.now())
    ticks.add(fn)
    ticker ??= setInterval(() => ticks.forEach((t) => t()), 1000)
    return () => {
      ticks.delete(fn)
      if (!ticks.size) {
        clearInterval(ticker)
        ticker = undefined
      }
    }
  }, [])
  return now
}

/** The current code of an otp string, refreshed as time goes. */
function useCode(otp: string | undefined): { params: OtpParams | null; code: string | null; remaining: number } {
  const params = useMemo(() => parseOtp(otp), [otp])
  const now = useSecond()
  const step = params ? (params.type === 'totp' ? Math.floor(now / 1000 / params.period) : params.counter) : -1
  const [code, setCode] = useState<string | null>(null)
  useEffect(() => {
    if (!params) return setCode(null)
    let stale = false
    void currentCode(params, Date.now()).then((c) => !stale && setCode(c.code))
    return () => {
      stale = true
    }
  }, [params, step])
  const remaining = params?.type === 'totp' ? params.period - (Math.floor(now / 1000) % params.period) : 0
  return { params, code, remaining }
}

/** A countdown ring: full when a new code starts, red as it runs out. */
function Ring({ remaining, period, small }: { remaining: number; period: number; small?: boolean }) {
  const p = remaining / period
  return (
    <span
      aria-hidden
      className={`relative inline-block shrink-0 rounded-full ${small ? 'size-4' : 'size-5.5'}`}
      style={{ background: `conic-gradient(var(--red) ${p * 360}deg, var(--line) 0)` }}
    >
      <span className={`absolute rounded-full bg-surface ${small ? 'inset-[3px]' : 'inset-1'}`} />
    </span>
  )
}

/** The code in a list row: small, with its ring; tapping it copies it. */
export function RowCode({ otp }: { otp: string }) {
  const { params, code, remaining } = useCode(otp)
  if (!params || !code) return null
  return (
    <button
      className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 font-mono text-[12.5px] font-bold hover:pressed-xs"
      onClick={(e) => (e.stopPropagation(), void copySecret(code, '2FA code'))}
      title="Copy 2FA code"
      aria-label={`Copy 2FA code ${code}`}
    >
      {groupCode(code)}
      {params.type === 'totp' && <Ring remaining={remaining} period={params.period} small />}
    </button>
  )
}

/** The 2FA code in an item's details: big, the ring and seconds left, copy (HOTP: "Next code"). */
export function OtpRow({ item }: { item: LoginItem }) {
  const { params, code, remaining } = useCode(item.d.otp)
  if (!item.d.otp) return null
  if (!params)
    return (
      <div className="flex min-h-15.5 items-center gap-2 border-b-2 border-line py-2.5">
        <div>
          <p className="text-xs font-semibold text-muted">2FA code</p>
          <p className="text-sm font-semibold text-brand-ink">The saved 2FA key isn’t valid. Edit the login to fix it.</p>
        </div>
      </div>
    )
  const next = async () => {
    try {
      await useVault.getState().save({ ...item, d: { ...item.d, otp: toOtpauth({ ...params, counter: params.counter + 1 }) } })
    } catch (e) {
      toastError(e)
    }
  }
  return (
    <div className="flex min-h-15.5 items-center gap-2 border-b-2 border-line py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-muted">2FA code</p>
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-xl font-bold tracking-[0.06em] tabular-nums">{code ? groupCode(code) : '··· ···'}</span>
          {params.type === 'totp' && (
            <>
              <Ring remaining={remaining} period={params.period} />
              <span className="text-xs text-muted tabular-nums">{remaining}s</span>
            </>
          )}
        </div>
      </div>
      {params.type === 'hotp' && (
        <button className="icon-btn-flat" onClick={() => void next()} aria-label="Next code" title="Next code">
          <RotateCw />
        </button>
      )}
      <button className="icon-btn-flat" disabled={!code} onClick={() => code && void copySecret(code, '2FA code')} aria-label="Copy 2FA code" title="Copy 2FA code">
        <Copy />
      </button>
    </div>
  )
}

// ---- getting a QR code in ----

/** Camera (Android), image, and paste: calls `onText` with whatever the QR code says. */
function QrButtons({ onText, multiple }: { onText: (text: string) => void; multiple?: boolean }) {
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const fromImages = async (files: FileList | File[]) => {
    setBusy(true)
    try {
      let found = 0
      for (const f of files) {
        const text = await readQrFromImage(f)
        if (text) {
          found++
          onText(text)
        }
      }
      if (!found) toast('No QR code found in that image')
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-wrap gap-3">
      <input ref={file} type="file" accept="image/*" multiple={multiple} hidden onChange={(e) => (e.target.files && void fromImages(e.target.files), (e.target.value = ''))} />
      {canScanWithCamera && (
        <button
          type="button"
          className="btn-secondary"
          onClick={() =>
            scanWithCamera().then((t) => t && onText(t), toastError)
          }
        >
          <Camera /> Scan QR code
        </button>
      )}
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => file.current?.click()}>
        {busy ? <Loader2 className="animate-spin" /> : <Image />} {multiple ? 'From images' : 'From an image'}
      </button>
    </div>
  )
}

/** The 2FA field of the login form: a key or link, scanned, from an image, or pasted (a screenshot too). */
export function OtpField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [error, setError] = useState<string | null>(null)
  const params = parseOtp(value)
  const use = (text: string) => {
    if (parseMigration(text)) return setError('That’s a Google Authenticator export. Use 2FA codes → Import from Google Authenticator.')
    if (!parseOtp(text)) return setError('That QR code isn’t a 2FA setup code')
    setError(null)
    onChange(text)
    toast('2FA key added')
  }
  return (
    <div onPaste={(e) => {
      const img = pastedImage(e)
      if (!img) return
      e.preventDefault()
      void readQrFromImage(img).then((t) => (t ? use(t) : setError('No QR code found in the pasted image')), toastError)
    }}>
      <TextField
        label="2FA key (optional)"
        value={value}
        onChange={(v) => (setError(null), onChange(v))}
        mono
        placeholder="Key, otpauth:// link, or paste a screenshot"
        error={error ?? (value.trim() && !params ? 'That isn’t a valid 2FA key' : undefined)}
        hint={params ? undefined : 'From the site’s two-factor setup page. TeleWarden then shows the 6-digit codes.'}
      />
      {params && <OtpPreview otp={value} />}
      <div className="mt-2.5">
        <QrButtons onText={use} />
      </div>
    </div>
  )
}

function OtpPreview({ otp }: { otp: string }) {
  const { params, code, remaining } = useCode(otp)
  if (!params || !code) return null
  return (
    <p className="mt-1.5 flex items-center gap-2 text-xs text-muted">
      <Check className="size-3.5 text-ink" /> Code now: <span className="font-mono font-bold text-ink">{groupCode(code)}</span>
      {params.type === 'totp' && <Ring remaining={remaining} period={params.period} small />}
      {params.issuer && <span>· {params.issuer}{params.account ? ` (${params.account})` : ''}</span>}
    </p>
  )
}

/** "Your phone's clock is off": codes depend on the time. */
export function ClockWarning() {
  const offset = telegramClockOffset()
  if (offset === null || Math.abs(offset) < 15) return null
  return (
    <div className="flex items-start gap-3 border-l-[3px] border-brand py-1 pl-3.5 text-[13px]">
      <TriangleAlert className="mt-0.5 size-5 shrink-0 text-brand-ink" />
      <span>
        This device’s clock is {Math.round(Math.abs(offset))} seconds {offset > 0 ? 'behind' : 'ahead'}, so 2FA codes may not work. Set the date and time
        to automatic in the device’s settings.
      </span>
    </div>
  )
}

// ---- the 2FA codes page ----

export function CodesPanel({ query, onAdd, onImport, onOpen }: { query: string; onAdd: () => void; onImport: () => void; onOpen: (id: string) => void }) {
  const items = useVault((s) => s.items)
  const list = items
    .filter((i): i is LoginItem => i.ty === 'login' && !i.tr && !!i.d.otp)
    .filter((i) => !query || `${i.n} ${i.d.u}`.toLowerCase().includes(query.toLowerCase()))
    .sort(byName)
  return (
    <div className="space-y-5">
      <ClockWarning />
      <div className="flex flex-wrap gap-3">
        <button className="btn-primary" onClick={onAdd}>
          <Plus /> Add 2FA code
        </button>
        <button className="btn-secondary" onClick={onImport}>
          <ScanQrCode /> Import from Google Authenticator
        </button>
      </div>
      {list.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((i) => (
            <CodeCard key={i.id} item={i} onOpen={() => onOpen(i.id)} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-md px-7 py-11 text-center pressed-lg">
          <span className="flex size-18 items-center justify-center rounded-md text-muted raised">
            <ScanQrCode className="size-8" />
          </span>
          <p className="text-[22px] font-black tracking-[-0.02em]">{query ? 'No matches' : 'No 2FA codes yet'}</p>
          <p className="max-w-[38ch] text-muted">
            {query ? `Nothing here matches “${query}”.` : 'Add the key from a site’s two-factor setup, or bring every account over from Google Authenticator.'}
          </p>
        </div>
      )}
    </div>
  )
}

function CodeCard({ item, onOpen }: { item: LoginItem; onOpen: () => void }) {
  const { params, code, remaining } = useCode(item.d.otp)
  return (
    <div className="card flex items-center gap-3.5 p-3.5">
      <button className="shrink-0" onClick={onOpen} aria-label={`Open ${item.n}`}>
        <ItemTile item={item} />
      </button>
      <button className="min-w-0 flex-1 text-left" onClick={() => code && void copySecret(code, '2FA code')} title="Copy 2FA code">
        <span className="block truncate text-sm font-bold">{item.n}</span>
        <span className="block truncate text-xs text-muted">{item.d.u || params?.account || ' '}</span>
        <span className="mt-1 flex items-center gap-2">
          <span className="font-mono text-[22px] font-bold tracking-[0.06em] tabular-nums">{code ? groupCode(code) : params ? '··· ···' : 'Invalid key'}</span>
          {params?.type === 'totp' && <Ring remaining={remaining} period={params.period} />}
        </span>
      </button>
      <button className="icon-btn-flat" disabled={!code} onClick={() => code && void copySecret(code, '2FA code')} aria-label="Copy 2FA code">
        <Copy />
      </button>
    </div>
  )
}

/** "Or paste the link": an otpauth-migration:// link read with another app. */
function LinkInput({ onLink }: { onLink: (text: string) => void }) {
  const [text, setText] = useState('')
  return (
    <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), text.trim() && (onLink(text.trim()), setText('')))}>
      <input className="input min-w-0 flex-1 font-mono text-[13px]" placeholder="Or paste the otpauth-migration:// link" aria-label="Export link" value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn-secondary" type="submit" disabled={!text.trim()}>Add</button>
    </form>
  )
}

// ---- adding one, importing many ----

type Target = string | 'new' | 'skip'

/** Where each 2FA account goes: a matched login, a new 2FA-only login, or nowhere. */
function TargetSelect({ value, onChange, options, label }: { value: Target; onChange: (v: Target) => void; options: VaultItem[]; label: string }) {
  return (
    <select className="input h-10 cursor-pointer text-[13px]" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.id} value={o.id}>Add to “{o.n}”</option>
      ))}
      <option value="new">New 2FA item</option>
      <option value="skip">Skip</option>
    </select>
  )
}

const otherLogins = (items: VaultItem[]) => items.filter((i): i is LoginItem => i.ty === 'login' && !i.tr).sort(byName)

/** Save 2FA accounts to their targets. Returns how many were saved. */
async function saveAccounts(entries: { params: OtpParams; target: Target }[]): Promise<number> {
  const vault = useVault.getState()
  let n = 0
  for (const { params, target } of entries) {
    if (target === 'skip') continue
    const otp = toOtpauth(params)
    if (target === 'new') {
      const item = blankItem('login', newVaultId()) as LoginItem
      await vault.save({ ...item, n: params.issuer || params.account || '2FA code', d: { ...item.d, u: params.account ?? '', otp } })
    } else {
      const login = useVault.getState().items.find((i): i is LoginItem => i.id === target && i.ty === 'login')
      if (!login) continue
      await vault.save({ ...login, d: { ...login.d, otp } })
    }
    n++
  }
  return n
}

/** Already in TeleWarden (the same key on some login)? */
const alreadySaved = (params: OtpParams, items: VaultItem[]) =>
  items.some((i) => i.ty === 'login' && !i.tr && parseOtp(i.d.otp) && base32Encode(parseOtp(i.d.otp)!.secret) === base32Encode(params.secret))

export function AddCodeDialog({ onClose }: { onClose: () => void }) {
  const items = useVault((s) => s.items)
  const [otp, setOtp] = useState('')
  const [target, setTarget] = useState<Target>('new')
  const [busy, setBusy] = useState(false)
  const params = parseOtp(otp)
  const who = params ? `${params.issuer ?? ''}\n${params.account ?? ''}` : null
  const matches = useMemo(() => {
    if (who === null) return []
    const [issuer, account] = who.split('\n')
    return matchLogins({ issuer, account }, items)
  }, [who, items])
  const options = [...matches, ...otherLogins(items).filter((i) => !matches.includes(i))]
  useEffect(() => setTarget(matches[0]?.id ?? 'new'), [matches])
  const save = async () => {
    if (!params) return
    setBusy(true)
    try {
      await saveAccounts([{ params, target }])
      toast('2FA code added')
      onClose()
    } catch (e) {
      toastError(e)
      setBusy(false)
    }
  }
  return (
    <Dialog
      title="Add 2FA code"
      icon={ScanQrCode}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!params || busy || target === 'skip'} onClick={() => void save()}>
            {busy ? <Loader2 className="animate-spin" /> : <Check />} Add
          </button>
        </>
      }
    >
      <div className="space-y-4 pb-1">
        <OtpField value={otp} onChange={setOtp} />
        {params && (
          <div>
            <p className="field-label">Where it goes</p>
            <TargetSelect value={target} onChange={setTarget} options={options} label="Where it goes" />
            {alreadySaved(params, items) && <p className="mt-1.5 text-xs font-semibold text-brand-ink">This 2FA key is already saved on a login.</p>}
          </div>
        )}
      </div>
    </Dialog>
  )
}

export function ImportGoogleDialog({ onClose }: { onClose: () => void }) {
  const items = useVault((s) => s.items)
  const [batches, setBatches] = useState<Map<number, MigrationBatch>>(new Map())
  const [targets, setTargets] = useState<Map<string, Target>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const list = [...batches.values()].sort((a, b) => a.index - b.index)
  const total = list[0]?.size ?? 0
  const accounts = list.flatMap((b) => b.accounts)
  const skipped = list.flatMap((b) => b.skipped)
  const keyOf = (p: OtpParams) => base32Encode(p.secret)

  const add = (text: string) => {
    const batch = parseMigration(text)
    if (!batch) return setError(parseOtp(text) ? 'That’s a single 2FA setup code. Use Add 2FA code instead.' : 'That isn’t a Google Authenticator export code')
    setError(null)
    setBatches((prev) => {
      const first = [...prev.values()][0]
      // A code from a different export starts over
      const next = new Map(first && first.id !== batch.id ? [] : prev)
      next.set(batch.index, batch)
      return next
    })
    setTargets((prev) => {
      const next = new Map(prev)
      for (const p of batch.accounts) if (!next.has(keyOf(p))) next.set(keyOf(p), alreadySaved(p, items) ? 'skip' : (matchLogins(p, items)[0]?.id ?? 'new'))
      return next
    })
  }

  const run = async () => {
    setBusy(true)
    try {
      const n = await saveAccounts(accounts.map((p) => ({ params: p, target: targets.get(keyOf(p)) ?? 'new' })))
      toast(`Imported ${n} 2FA code${n === 1 ? '' : 's'}`)
      onClose()
    } catch (e) {
      toastError(e)
      setBusy(false)
    }
  }

  const missing = total - list.length
  return (
    <Dialog
      title="Import from Google Authenticator"
      subtitle={total ? `QR code${total === 1 ? '' : 's'}: ${list.length} of ${total} read` : 'All your accounts at once'}
      icon={ScanQrCode}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!accounts.length || busy} onClick={() => void run()}>
            {busy ? <Loader2 className="animate-spin" /> : <Check />} Import {accounts.filter((p) => targets.get(keyOf(p)) !== 'skip').length || ''}
          </button>
        </>
      }
    >
      <div className="space-y-4 pb-1" onPaste={(e) => {
        const img = pastedImage(e)
        if (img) void readQrFromImage(img).then((t) => (t ? add(t) : setError('No QR code found in the pasted image')), toastError)
      }}>
        {!accounts.length && (
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>In Google Authenticator, tap ⋮ → <b>Transfer accounts</b> → <b>Export accounts</b>.</li>
            <li>Pick the accounts. It shows one or more QR codes.</li>
            <li>{canScanWithCamera ? 'Scan each QR code here.' : 'Take a screenshot of each QR code (or a photo), then add them here or paste them.'}</li>
          </ol>
        )}
        <QrButtons onText={add} multiple />
        <LinkInput onLink={add} />
        {error && <ErrorText>{error}</ErrorText>}
        {missing > 0 && <p className="text-[13px] font-semibold text-brand-ink">{missing} more QR code{missing === 1 ? '' : 's'} to read from this export.</p>}
        {accounts.length > 0 && (
          <ul className="divide-y-2 divide-line">
            {accounts.map((p) => (
              <li key={keyOf(p)} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{p.issuer || p.account || 'Account'}</p>
                  <p className="truncate text-xs text-muted">
                    {p.account}
                    {alreadySaved(p, items) && ' · already in TeleWarden'}
                    {p.type === 'hotp' && ' · counter-based'}
                  </p>
                </div>
                <div className="w-full sm:w-56">
                  <TargetSelect
                    value={targets.get(keyOf(p)) ?? 'new'}
                    onChange={(v) => setTargets((prev) => new Map(prev).set(keyOf(p), v))}
                    options={[...matchLogins(p, items), ...otherLogins(items).filter((i) => !matchLogins(p, items).includes(i))]}
                    label={`Where ${p.issuer || p.account} goes`}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        {skipped.length > 0 && <p className="text-xs text-muted">Not supported (MD5): {skipped.join(', ')}</p>}
        <p className="text-xs text-muted">Microsoft Authenticator and Authy can’t export. For those sites, set up two-factor again and scan the new QR code.</p>
      </div>
    </Dialog>
  )
}
