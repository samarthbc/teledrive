import { X, type LucideIcon } from 'lucide-react'
import { useEffect } from 'react'
import { useBackHandler } from '../native/backButton'

/** Centred on wider screens, a bottom sheet on phones. */
export default function Dialog(props: {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  wide?: boolean
  /** A tile beside the title, e.g. a lock for lock actions. */
  icon?: LucideIcon
  /** Red icon (locks, destructive actions). */
  alert?: boolean
  subtitle?: React.ReactNode
}) {
  const { title, onClose, children, footer, wide, icon: Icon, alert, subtitle } = props
  useBackHandler(true, onClose)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-surface shadow-[0_-10px_30px_rgba(0,0,0,0.18)] sm:max-h-[90vh] sm:rounded-md sm:raised-xl ${
          wide ? 'sm:max-w-[520px]' : 'sm:max-w-[440px]'
        }`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2.5 h-1.25 w-10 shrink-0 rounded-full pressed-xs sm:hidden" aria-hidden />
        <div className="flex items-start gap-3 px-5.5 pt-4 pb-3 sm:px-6.5 sm:pt-6.5">
          {Icon && (
            <div
              className={`flex size-10 shrink-0 items-center justify-center rounded-md bg-surface raised-sm ${alert ? 'text-brand-ink' : 'text-ink'}`}
            >
              <Icon className="size-5" />
            </div>
          )}
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 className="text-xl leading-tight font-black tracking-[-0.02em] break-words">{title}</h2>
            {subtitle && <p className="mt-1 text-[13px] text-muted">{subtitle}</p>}
          </div>
          <button className="-mt-1 -mr-2 icon-btn-flat" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        {/* Side padding leaves room for raised controls' shadows inside the scrolling area */}
        <div className="overflow-y-auto px-5.5 py-2 sm:px-6.5">{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-3 px-5.5 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6.5 sm:pb-6.5">
            {footer}
          </div>
        )}
        {!footer && <div className="h-4 shrink-0 sm:h-5" />}
      </div>
    </div>
  )
}
