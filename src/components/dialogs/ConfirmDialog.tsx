import { Loader2, Trash2, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { verifyPassword } from '../../drive/vault'
import Dialog from '../Dialog'
import { ErrorText, PasswordField } from '../ui'

export default function ConfirmDialog(props: {
  title: string
  message: React.ReactNode
  confirmLabel: string
  danger?: boolean
  icon?: LucideIcon
  onConfirm: () => Promise<void>
  onClose: () => void
  /** Ask for the TeleDrive password first (e.g. deleting locked items); the text says why. */
  requirePassword?: string
}) {
  const { title, message, confirmLabel, danger, icon, onConfirm, onClose, requirePassword } = props
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
      icon={icon ?? (danger ? Trash2 : undefined)}
      alert={danger}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className={danger ? 'btn-danger-solid' : 'btn-primary'}
            disabled={busy || (!!requirePassword && !password)}
            onClick={confirm}
          >
            {busy && <Loader2 className="animate-spin" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-muted">{message}</div>
      {requirePassword && (
        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (password) void confirm()
          }}
        >
          <PasswordField
            label="TeleDrive password"
            kind="account"
            hint={requirePassword}
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
            error={!!error}
          />
        </form>
      )}
      {error && (
        <div className="mt-3">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </Dialog>
  )
}
