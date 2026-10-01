import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import { saveKeys, validateKeys } from '../config'
import { useDrive } from '../store/useDrive'
import AuthLayout from './AuthLayout'
import { ErrorText } from '../components/ui'

/** Only shown when the app was built without API keys in .env. */
export default function SetupPage() {
  const boot = useDrive((s) => s.boot)
  const [apiId, setApiId] = useState('')
  const [apiHash, setApiHash] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const problem = validateKeys(apiId, apiHash)
    if (problem) return setError(problem)
    await saveKeys(apiId, apiHash)
    await boot()
  }

  return (
    <AuthLayout icon={KeyRound} title="Connect your Telegram API" subtitle="One-time setup. Keys stay on this device.">
      <form onSubmit={submit} className="space-y-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted marker:font-bold marker:text-brand-ink">
          <li>
            Open{' '}
            <a href="https://my.telegram.org" target="_blank" rel="noreferrer" className="font-bold text-ink underline decoration-brand decoration-2 underline-offset-2">
              my.telegram.org
            </a>{' '}
            and log in
          </li>
          <li>Go to “API development tools” and create an app</li>
          <li>Copy the api_id and api_hash below</li>
        </ol>
        <input className="input" inputMode="numeric" placeholder="api_id" aria-label="api_id" value={apiId} onChange={(e) => setApiId(e.target.value)} />
        <input className="input font-mono" placeholder="api_hash" aria-label="api_hash" value={apiHash} onChange={(e) => setApiHash(e.target.value)} />
        {error && <ErrorText>{error}</ErrorText>}
        <button className="btn-primary w-full">Continue</button>
      </form>
    </AuthLayout>
  )
}
