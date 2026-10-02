import type { LucideIcon } from 'lucide-react'
import GetApps from '../components/GetApps'
import Logo from '../components/Logo'
import { isAndroid } from '../native/android'
import { isDesktop } from '../native/desktop'

/** Sign-in screens: the Swiss wordmark beside (desktop) or above (phone) a raised card. */
export default function AuthLayout(props: {
  /** A step's icon; without one, the TeleDrive logo. */
  icon?: LucideIcon
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  const { icon: Icon, title, subtitle, children } = props
  return (
    <div className="flex min-h-full flex-col overflow-y-auto lg:flex-row">
      <div className="flex flex-col justify-between gap-6 px-6 pt-12 pb-6 lg:w-[520px] lg:shrink-0 lg:p-16">
        <p className="text-[64px] leading-[0.9] font-black tracking-[-0.05em] lg:text-[96px] lg:tracking-[-0.055em]" aria-label="TeleDrive">
          Tele
          <br />
          Drive<span className="text-brand-ink">.</span>
        </p>
        <p className="border-t-[3px] border-ink pt-3.5 text-sm leading-relaxed font-bold lg:text-[15px]">
          Unlimited storage on Telegram.
          <br />
          <span className="font-medium text-muted">Encrypted before it leaves your device.</span>
        </p>
      </div>
      <div className="flex flex-1 flex-col items-center justify-start gap-10 px-4 pb-10 lg:justify-center lg:p-10">
        <div className="w-full max-w-[460px] rounded-md bg-surface p-6 raised-xl sm:p-9">
          <div className="mb-6 flex flex-col gap-4">
            {Icon ? (
              <div className="flex size-13 items-center justify-center rounded-md bg-brand text-white raised-sm">
                <Icon className="size-6.5" strokeWidth={2.2} />
              </div>
            ) : (
              <Logo className="size-13" />
            )}
            <div>
              <h1 className="text-[28px] leading-[1.05] font-black tracking-[-0.035em] sm:text-[34px]">{title}</h1>
              <p className="mt-2.5 text-sm leading-relaxed text-muted">{subtitle}</p>
            </div>
          </div>
          {children}
        </div>
        {/* The website offers the apps; the apps themselves don't */}
        {!isAndroid && !isDesktop && <GetApps className="w-full max-w-[460px] px-1" />}
      </div>
    </div>
  )
}
