import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { verifyPassword } from '../../drive/vault'
import Dialog from '../Dialog'

export default function ConfirmDialog(props: {
  title: string
  message: React.ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => Promise<void>
  onClose: () => void
  /** Ask for the TeleDrive password first (e.g. deleting locked items); the text says why. */
  requirePassword?: string
}) {
  const { title, message, confirmLabel, danger, onConfirm, onClose, requirePassword } = props
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState('')

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      if (requirePassword && !(await verifyPassword(password))) throw new Error('Wrong TeleDrive password')
      await onConfirm()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className={danger ? 'btn-danger' : 'btn-primary'} disabled={busy || (!!requirePassword && !password)} onClick={confirm}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm text-slate-600 dark:text-slate-400">{message}</div>
      {requirePassword && (
        <form
          className="mt-3 space-y-1 text-sm"
          onSubmit={(e) => {
            e.preventDefault()
            if (password) void confirm()
          }}
        >
          <label className="block text-slate-600 dark:text-slate-400" htmlFor="confirm-password">
            {requirePassword}
          </label>
          <input
            id="confirm-password" className="input" type="password" autoFocus autoComplete="current-password"
            placeholder="TeleDrive password" value={password} onChange={(e) => setPassword(e.target.value)}
          />
        </form>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Dialog>
  )
}
