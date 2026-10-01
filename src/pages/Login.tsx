import { ArrowLeft, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { checkPassword, describeError, sendCode, signIn } from '../telegram/auth'
import { useDrive } from '../store/useDrive'
import AuthLayout from './AuthLayout'
import { ErrorText, Note, PasswordField } from '../components/ui'

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
    phone: 'Your files are stored in a private channel in your own Telegram account.',
    code: viaApp ? `We sent a code to your Telegram app (${phone})` : `We sent a code by SMS to ${phone}`,
    password: 'Your account has two-step verification. Enter your password.',
  }

  return (
    <AuthLayout title={step === 'phone' ? 'Log in with Telegram' : step === 'code' ? 'Enter the code' : 'Two-step verification'} subtitle={subtitles[step]}>
      <form onSubmit={submit} className="space-y-4">
        {notice && step === 'phone' && (
          <Note>{notice}</Note>
        )}
        {step === 'phone' && (
          <div>
            <label className="field-label" htmlFor="login-phone">
              Phone number
            </label>
            <input
              id="login-phone" className="input" type="tel" autoComplete="tel" autoFocus placeholder="+91 98765 43210"
              value={phone} onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        )}
        {step === 'code' && (
          <div>
            <label className="field-label" htmlFor="login-code">
              Login code
            </label>
            <input
              id="login-code" className="input h-14 text-center font-mono text-xl tracking-[0.4em]" inputMode="numeric"
              autoComplete="one-time-code" autoFocus placeholder="•••••" maxLength={6}
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </div>
        )}
        {step === 'password' && (
          <PasswordField
            label="Telegram two-step password" kind="account" autoComplete="current-password" autoFocus
            value={password} onChange={setPassword} error={!!error}
          />
        )}

        {error && <ErrorText>{error}</ErrorText>}

        <button className="btn-primary w-full" disabled={busy || (step === 'phone' ? phone.length < 6 : step === 'code' ? code.length < 5 : !password)}>
          {busy && <Loader2 className="animate-spin" />}
          {step === 'phone' ? 'Send code' : 'Log in'}
        </button>

        {step !== 'phone' && (
          <button type="button" className="btn-ghost w-full" onClick={() => { setStep('phone'); setCode(''); setPassword(''); setError(null) }}>
            <ArrowLeft /> Use a different number
          </button>
        )}
      </form>
    </AuthLayout>
  )
}
