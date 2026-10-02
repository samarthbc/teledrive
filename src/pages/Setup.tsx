import { ChevronRight, Hash, KeyRound, Loader2 } from 'lucide-react'
import { useId, useState } from 'react'
import { parseKeys, saveKeys, validateKeys } from '../config'
import { useDrive } from '../store/useDrive'
import AuthLayout from './AuthLayout'
import { ErrorText, PasswordField } from '../components/ui'

/** Asks for the Telegram API keys: in every public build (website and apps), once per device. */
export default function SetupPage() {
  const boot = useDrive((s) => s.boot)
  const notice = useDrive((s) => s.setupNotice)
  const [apiId, setApiId] = useState('')
  const [apiHash, setApiHash] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const idField = useId()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const problem = validateKeys(apiId, apiHash)
    if (problem) return setError(problem)
    setBusy(true)
    await saveKeys(apiId, apiHash)
    useDrive.setState({ setupNotice: null })
    await boot()
    setBusy(false)
  }

  // Both keys pasted at once (e.g. copied together from my.telegram.org) fill both fields
  const onPaste = (field: 'id' | 'hash') => (e: React.ClipboardEvent<HTMLInputElement>) => {
    const found = parseKeys(e.clipboardData.getData('text'))
    const value = field === 'id' ? found.apiId : found.apiHash
    if (!value && !(found.apiId && found.apiHash)) return
    e.preventDefault()
    if (found.apiId) setApiId(found.apiId)
    if (found.apiHash) setApiHash(found.apiHash)
    setError(null)
  }

  return (
    <AuthLayout icon={KeyRound} title="Connect your Telegram API" subtitle="One-time setup on this device.">
      <form onSubmit={submit} className="space-y-4">
        {notice && <ErrorText>{notice}</ErrorText>}
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted marker:font-bold marker:text-brand-ink">
          <li>
            Open{' '}
            <a href="https://my.telegram.org" target="_blank" rel="noreferrer" className="font-bold text-ink underline decoration-brand decoration-2 underline-offset-2">
              my.telegram.org
            </a>{' '}
            and log in
          </li>
          <li>Go to “API development tools” and create an app (any name)</li>
          <li>Copy the api_id and api_hash below; pasting both at once works too</li>
        </ol>
        <details className="group text-[13px] leading-relaxed text-muted">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 font-bold text-ink [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 transition-transform group-open:rotate-90" /> More help
          </summary>
          <ul className="mt-2 list-disc space-y-1.5 pl-10 marker:text-brand-ink">
            <li>
              <b className="text-ink">Log in:</b> your phone number with the country code (+91…). The code arrives in your
              Telegram app, not by SMS.
            </li>
            <li>
              <b className="text-ink">App title and short name:</b> anything, e.g. TeleDrive and teledrive (short name: 5–32
              letters or digits). URL and description can stay empty.
            </li>
            <li>
              <b className="text-ink">Platform:</b> choose Desktop. Any works the same.
            </li>
            <li>
              <b className="text-ink">“ERROR” when creating:</b> turn off any VPN or ad blocker, then try again, in another
              browser, or on mobile data. Telegram sometimes needs a few minutes.
            </li>
            <li>
              <b className="text-ink">Already made one?</b> Reuse it: the api_id and api_hash are on the same page.
            </li>
          </ul>
        </details>
        <div>
          <label className="field-label" htmlFor={idField}>
            api_id
          </label>
          <div className="relative">
            <Hash className="pointer-events-none absolute top-1/2 left-3.5 size-[17px] -translate-y-1/2 text-muted" />
            <input
              id={idField} className={`input pl-10.5 ${error?.includes('api_id') ? 'input-error' : ''}`} inputMode="numeric"
              autoComplete="off" spellCheck={false} placeholder="e.g. 1234567"
              value={apiId} onChange={(e) => setApiId(e.target.value.trim())} onPaste={onPaste('id')}
            />
          </div>
        </div>
        <PasswordField
          label="api_hash" icon={KeyRound} mono autoComplete="off" placeholder="32 letters and digits"
          value={apiHash} onChange={(v) => setApiHash(v.trim())} onPaste={onPaste('hash')} error={!!error?.includes('api_hash')}
        />
        {error && <ErrorText>{error}</ErrorText>}
        <button className="btn-primary w-full" disabled={busy || !apiId || !apiHash}>
          {busy && <Loader2 className="animate-spin" />}
          Continue
        </button>
        <details className="group text-[13px] leading-relaxed text-muted">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 font-bold text-ink [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 transition-transform group-open:rotate-90" /> Why do I need this?
          </summary>
          <p className="mt-2 pl-5.5">
            TeleDrive talks to Telegram directly from your device, with no server in between. Telegram asks every app
            for these keys to know which app is connecting. They don't give access to your account or your files, and
            they're only saved on this device.
          </p>
        </details>
      </form>
    </AuthLayout>
  )
}
