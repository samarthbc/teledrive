import { X } from 'lucide-react'
import { useEffect } from 'react'

export default function Dialog(props: {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  wide?: boolean
}) {
  const { title, onClose, children, footer, wide } = props

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className={`card flex max-h-[90vh] w-full flex-col rounded-b-none sm:rounded-2xl ${wide ? 'sm:max-w-lg' : 'sm:max-w-sm'}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="truncate text-base font-semibold">{title}</h2>
          <button className="icon-btn -mr-2" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-2">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-5 pt-2 pb-4">{footer}</div>}
      </div>
    </div>
  )
}
