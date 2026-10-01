import { Check, X } from 'lucide-react'
import { useToast } from '../store/useToast'

/** Phone: at the top (the bottom has the tabs and the + button). Wider screens: bottom right. */
export default function Toasts() {
  const toasts = useToast((s) => s.toasts)
  const dismiss = useToast((s) => s.dismiss)
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-3 px-3 md:top-auto md:right-4.5 md:bottom-4.5 md:left-auto md:items-end md:px-0">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          onClick={() => dismiss(t.id)}
          className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-md bg-surface px-4 py-3 text-sm font-semibold raised-md md:w-auto"
        >
          {t.kind === 'error' ? (
            <X className="size-4.5 shrink-0 text-brand-ink" strokeWidth={2.4} />
          ) : (
            <Check className="size-4.5 shrink-0" strokeWidth={2.4} />
          )}
          <span className={`min-w-0 flex-1 ${t.kind === 'error' ? 'text-brand-ink' : ''}`}>{t.message}</span>
          {t.action && (
            <button
              className="-my-1 shrink-0 rounded-md px-2 py-1 text-[13px] font-extrabold text-brand-ink active:pressed"
              onClick={(e) => {
                e.stopPropagation()
                dismiss(t.id)
                t.action!.onClick()
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
