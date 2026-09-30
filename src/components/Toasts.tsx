import { useToast } from '../store/useToast'

export default function Toasts() {
  const toasts = useToast((s) => s.toasts)
  const dismiss = useToast((s) => s.dismiss)
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto max-w-md rounded-xl px-4 py-2.5 text-sm text-white shadow-lg ${
            t.kind === 'error' ? 'bg-red-600' : 'bg-slate-800 dark:bg-slate-700'
          }`}
        >
          {t.message}
        </button>
      ))}
    </div>
  )
}
