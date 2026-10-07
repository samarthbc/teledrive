import { ArrowLeft, Fingerprint, Loader2, Search, TriangleAlert, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ErrorText, PasswordField } from '../components/ui'
import { ItemTile } from '../components/vault/parts'
import { Native } from '../native/android'
import { useVault } from '../store/useVault'
import { byName, matchesSearch, subtitleOf, type LoginItem, type VaultItem } from '../vault/items'
import { matchingLogins, targetLabel, urlMatches, type FillTarget } from '../vault/match'
import { currentCode, parseOtp } from '../vault/totp'
import { copySecret } from '../vault/clipboard'
import { formType, valuesFor, type FieldKind } from './fill'

// The autofill window (AutofillActivity.java): unlock TeleWarden, pick a login (or a card, or an identity), fill.
// The vault is read from what TeleDrive keeps on this phone; nothing goes to Telegram from here.

export interface FillRequest {
  target: FillTarget
  /** The app's name (apps only). */
  appName?: string
  fields: FieldKind[]
}

export default function AutofillApp({ request, problem }: { request: FillRequest; problem: string | null }) {
  const status = useVault((s) => s.status)
  const label = targetLabel(request.target, request.appName)
  const cancel = () => void Native.autofillCancel().catch(() => window.close())

  let body: React.ReactNode
  if (problem) body = <Message>{problem}</Message>
  else if (status === 'none') body = <Message>TeleWarden isn’t set up yet. Open TeleDrive → TeleWarden to set it up.</Message>
  else if (status === 'locked') body = <Unlock />
  else body = <Pick request={request} label={label} />

  return (
    <div className="mx-auto flex min-h-full max-w-[560px] flex-col gap-4 px-4 pt-[max(16px,env(safe-area-inset-top))] pb-6">
      <header className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-brand text-white raised-sm">
          <Fingerprint className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-extrabold tracking-[0.1em] text-muted uppercase">TeleWarden</p>
          <p className="truncate font-bold">Fill in {label}</p>
        </div>
        <button type="button" className="icon-btn" onClick={cancel} aria-label="Close">
          <X />
        </button>
      </header>
      {body}
    </div>
  )
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <div className="panel flex gap-3 p-5 text-sm">
      <TriangleAlert className="size-5 shrink-0 text-brand-ink" />
      <p>{children}</p>
    </div>
  )
}

function Unlock() {
  const bioSet = useVault((s) => s.bioSet)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const asked = useRef(false)

  const fingerprint = async () => {
    setError(null)
    try {
      await useVault.getState().unlockWithBio()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  // The fingerprint straight away when it's set up
  useEffect(() => {
    if (!bioSet || asked.current) return
    asked.current = true
    void fingerprint()
  }, [bioSet])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password) return
    setBusy(true)
    setError(null)
    try {
      await useVault.getState().unlock(password)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="panel space-y-4 p-5" onSubmit={(e) => void submit(e)}>
      <p className="font-bold">Unlock TeleWarden</p>
      <PasswordField label="Master password" value={password} onChange={setPassword} autoComplete="current-password" autoFocus={!bioSet} />
      {error && <ErrorText>{error}</ErrorText>}
      <div className="flex gap-2.5">
        <button type="submit" className="btn-primary flex-1" disabled={busy || !password}>
          {busy && <Loader2 className="animate-spin" />} Unlock
        </button>
        {bioSet && (
          <button type="button" className="btn-secondary" onClick={() => void fingerprint()} aria-label="Unlock with fingerprint">
            <Fingerprint />
          </button>
        )}
      </div>
    </form>
  )
}

function Pick({ request, label }: { request: FillRequest; label: string }) {
  const items = useVault((s) => s.items)
  const [query, setQuery] = useState('')
  const [confirm, setConfirm] = useState<VaultItem | null>(null)
  const [busy, setBusy] = useState(false)
  const type = formType(request.fields)

  const suggested = useMemo(() => (type === 'login' ? matchingLogins(items, request.target) : []), [items, request.target, type])
  const all = useMemo(() => items.filter((i) => i.ty === type && !i.tr).sort(byName), [items, type])
  const shown = query ? all.filter((i) => matchesSearch(i, query)) : type === 'login' ? suggested : all

  const fill = async (item: VaultItem) => {
    setBusy(true)
    try {
      // A login with a 2FA code: the code goes to the clipboard for the next screen
      if (item.ty === 'login' && item.d.otp) {
        const params = parseOtp(item.d.otp)
        if (params?.type === 'totp') await copySecret((await currentCode(params)).code, '2FA code')
      }
      const values = valuesFor(item, request.fields) as Record<string, string>
      useVault.getState().lock()
      await Native.autofillFill({ values })
    } catch {
      setBusy(false)
    }
  }
  const choose = (item: VaultItem) => {
    // A login saved for somewhere else: ask first
    const fits = item.ty !== 'login' || (item as LoginItem).d.urls.some((u) => urlMatches(u, request.target))
    if (fits) void fill(item)
    else setConfirm(item)
  }

  if (confirm) {
    const saved = (confirm as LoginItem).d.urls[0]?.u
    return (
      <div className="panel space-y-4 p-5">
        <p className="font-bold">Fill “{confirm.n}” in {label}?</p>
        <p className="text-sm text-muted">
          {saved ? `It’s saved for ${saved}.` : 'It isn’t saved for any website or app.'} Only fill it if you trust {label}.
        </p>
        <div className="flex gap-2.5">
          <button type="button" className="btn-secondary" onClick={() => setConfirm(null)}>
            <ArrowLeft /> Back
          </button>
          <button type="button" className="btn-primary flex-1" disabled={busy} onClick={() => void fill(confirm)}>
            Fill anyway
          </button>
        </div>
      </div>
    )
  }

  const noun = type === 'login' ? 'logins' : type === 'card' ? 'cards' : 'identities'
  return (
    <>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted" />
        <input type="search" className="input pl-10.5" placeholder={`Search all ${noun}`} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={`Search ${noun}`} />
      </div>
      {!query && type === 'login' && <p className="label-swiss">{suggested.length ? `For ${label}` : `No logins saved for ${label}`}</p>}
      {shown.length ? (
        <div className="panel divide-y-2 divide-line px-2">
          {shown.map((i) => (
            <button key={i.id} type="button" disabled={busy} className="flex w-full items-center gap-3.5 rounded-md px-2.5 py-3 text-left active:pressed" onClick={() => choose(i)}>
              <ItemTile item={i} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold">{i.n}</span>
                <span className="block truncate text-[13px] text-muted">{subtitleOf(i)}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">{query ? `Nothing matches “${query}”.` : type === 'login' ? `Search above to fill a login saved for another site.` : `No ${noun} yet.`}</p>
      )}
    </>
  )
}
