import { ArrowLeft, KeyRound, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { builtInKeys } from '../config'
import { fullPhone, guessCountryCode, isCountryCode, rememberCountryCode, splitPhone } from '../lib/phone'
import { checkPassword, describeError, errorCode, sendCode, signIn } from '../telegram/auth'
import { BAD_KEYS_NOTICE, useDrive } from '../store/useDrive'
import AuthLayout from './AuthLayout'
import { ErrorText, Note, PasswordField } from '../components/ui'

type Step = 'phone' | 'code' | 'password'

export default function LoginPage() {
  const afterLogin = useDrive((s) => s.afterLogin)
  const notice = useDrive((s) => s.loginNotice)
  const changeKeys = useDrive((s) => s.changeKeys)
  const ownKeys = !builtInKeys()
  const [step, setStep] = useState<Step>('phone')
  const [countryCode, setCountryCode] = useState(guessCountryCode)
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
      // Keys entered on Setup that Telegram doesn't know: back to Setup to fix them
      if (errorCode(e) === 'API_ID_INVALID' && ownKeys) return void changeKeys(BAD_KEYS_NOTICE)
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  const fullNumber = fullPhone(countryCode, phone)
  const phoneDigits = phone.replace(/\D/g, '').length

  // A whole "+91 98765 43210" typed or pasted into either box goes into both
  const enterPhone = (text: string) => {
    const split = splitPhone(text)
    if (split) {
      setCountryCode(split.code)
      setPhone(split.number)
    } else setPhone(text)
  }
  const enterCode = (text: string) => {
    const split = splitPhone(text.startsWith('+') ? text : `+${text}`)
    // Only digits fit here; a pasted full number spills its rest into the number box
    if (split && split.number) {
      setCountryCode(split.code)
      setPhone(split.number)
    } else setCountryCode(text.replace(/\D/g, '').slice(0, 3))
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (step === 'phone')
      return run(async () => {
        const res = await sendCode(fullNumber)
        rememberCountryCode(countryCode)
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
    code: viaApp ? `We sent a code to your Telegram app (+${countryCode} ${phone})` : `We sent a code by SMS to +${countryCode} ${phone}`,
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
            <div className="flex gap-2.5">
              <div className="relative w-22 shrink-0">
                <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-sm font-bold text-muted">+</span>
                <input
                  className={`input pl-7.5 ${countryCode.length === 3 && !isCountryCode(countryCode) ? 'input-error' : ''}`} type="tel"
                  inputMode="numeric" autoComplete="tel-country-code" aria-label="Country code" placeholder="91"
                  value={countryCode} onChange={(e) => enterCode(e.target.value)}
                />
              </div>
              <input
                id="login-phone" className="input min-w-0 flex-1" type="tel" autoComplete="tel-national" autoFocus
                placeholder="98765 43210" value={phone} onChange={(e) => enterPhone(e.target.value)}
              />
            </div>
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

        <button className="btn-primary w-full" disabled={busy || (step === 'phone' ? !isCountryCode(countryCode) || phoneDigits < 4 : step === 'code' ? code.length < 5 : !password)}>
          {busy && <Loader2 className="animate-spin" />}
          {step === 'phone' ? 'Send code' : 'Log in'}
        </button>

        {step !== 'phone' && (
          <button type="button" className="btn-ghost w-full" onClick={() => { setStep('phone'); setCode(''); setPassword(''); setError(null) }}>
            <ArrowLeft /> Use a different number
          </button>
        )}
        {step === 'phone' && ownKeys && (
          <button type="button" className="btn-ghost w-full text-muted" onClick={() => void changeKeys()}>
            <KeyRound /> Use different API keys
          </button>
        )}
      </form>
    </AuthLayout>
  )
}
