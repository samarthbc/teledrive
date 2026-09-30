import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import Dialog from '../Dialog'

/** Asks for a name (new folder, rename). Selects the name without its extension. */
export default function PromptDialog(props: {
  title: string
  initial?: string
  confirmLabel: string
  onSubmit: (value: string) => Promise<void>
  onClose: () => void
}) {
  const { title, initial = '', confirmLabel, onSubmit, onClose } = props
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSubmit(value)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 pb-4">
        <input
          className="input"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => {
            const dot = initial.lastIndexOf('.')
            e.target.setSelectionRange(0, dot > 0 ? dot : initial.length)
          }}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy || !value.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
