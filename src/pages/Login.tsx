import { ArrowLeft, Loader2, Send } from 'lucide-react'
import { useState } from 'react'
import { checkPassword, describeError, sendCode, signIn } from '../telegram/auth'
import { useDrive } from '../store/useDrive'
import AuthLayout from './AuthLayout'

type Step = 'phone' | 'code' | 'password'

export default function LoginPage() {
  const afterLogin = useDrive((s) => s.afterLogin)
  const notice = useDrive((s) => s.loginNotice)
  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [viaApp, setViaApp] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (step === 'phone')
      return run(async () => {
        const res = await sendCode(phone)
        setViaApp(res.viaApp)
        setStep('code')
      })
    if (step === 'code')
      return run(async () => {
        const res = await signIn(code)
        if (res === 'password') setStep('password')
        else if (res === 'signup') setError('No Telegram account uses this number. Sign up in the Telegram app first.')
        else await afterLogin()
      })
    return run(async () => {
      await checkPassword(password)
      await afterLogin()
    })
  }

  const subtitles: Record<Step, string> = {
    phone: 'Log in with your Telegram account',
    code: viaApp ? `We sent a code to your Telegram app (${phone})` : `We sent a code by SMS to ${phone}`,
    password: 'Your account has two-step verification. Enter your password.',
  }

  return (
    <AuthLayout icon={Send} title="TeleDrive" subtitle={subtitles[step]}>
      <form onSubmit={submit} className="space-y-4">
        {notice && step === 'phone' && (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">{notice}</p>
        )}
        {step === 'phone' && (
          <input
            className="input" type="tel" autoComplete="tel" autoFocus placeholder="+91 98765 43210"
            value={phone} onChange={(e) => setPhone(e.target.value)}
          />
        )}
        {step === 'code' && (
          <input
            className="input text-center font-mono text-lg tracking-[0.4em]" inputMode="numeric"
            autoComplete="one-time-code" autoFocus placeholder="•••••" maxLength={6}
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
        )}
        {step === 'password' && (
          <input
            className="input" type="password" autoComplete="current-password" autoFocus placeholder="Password"
            value={password} onChange={(e) => setPassword(e.target.value)}
          />
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button className="btn-primary w-full py-2.5" disabled={busy || (step === 'phone' ? phone.length < 6 : step === 'code' ? code.length < 5 : !password)}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {step === 'phone' ? 'Send code' : 'Log in'}
        </button>

        {step !== 'phone' && (
          <button type="button" className="btn-ghost w-full" onClick={() => { setStep('phone'); setCode(''); setPassword(''); setError(null) }}>
            <ArrowLeft className="h-4 w-4" /> Use a different number
          </button>
        )}
      </form>
      <p className="mt-6 text-center text-xs text-slate-400">
        Your files are stored in a private channel in your own Telegram account.
      </p>
    </AuthLayout>
  )
}
