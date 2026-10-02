import { KeyRound, Loader2, Lock, LockOpen } from 'lucide-react'
import { useState } from 'react'
import { WrongPasswordError } from '../../drive/crypto'
import { changeItemPassword, lockItem, removeLock, unlockItem } from '../../drive/ops'
import { LOCKED_FILE_NAME, LOCKED_FOLDER_NAME, type Item } from '../../drive/tree'
import { verifyPassword } from '../../drive/vault'
import { MIN_PASSWORD } from '../../pages/Password'
import { useDrive } from '../../store/useDrive'
import { toast } from '../../store/useToast'
import Dialog from '../Dialog'
import { Choice, ErrorText, Note, PasswordField } from '../ui'

export type LockAction = 'lock' | 'unlock' | 'remove' | 'change'

/**
 * Locked files and folders. Locking, removing a lock and changing a password first ask for the
 * TeleDrive password (so it's really the owner); opening only needs the item's own password.
 */
export default function LockDialog(props: {
  item: Item
  action: LockAction
  onClose: () => void
  /** After locking with "re-encrypt": upload the item's files again (it's unlocked for that). */
  onReencrypt?: (item: Item) => void
  /** After unlocking (e.g. open the folder or file that was clicked). */
  onUnlocked?: (item: Item) => void
}) {
  const { item, action, onClose, onReencrypt, onUnlocked } = props
  const [account, setAccount] = useState('')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [reencrypt, setReencrypt] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const what = item.kind === 'folder' ? 'folder' : 'file'
  // Items locked before names showed while locked have no name to show until they're unlocked once
  const placeholderName = item.locked && (item.name === LOCKED_FOLDER_NAME || item.name === LOCKED_FILE_NAME)
  const needsAccount = action !== 'unlock'
  const needsNew = action === 'lock' || action === 'change'

  const run = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (needsAccount && !(await verifyPassword(account))) throw new Error('Wrong TeleDrive password')
      const drive = useDrive.getState().drive
      const fresh = drive.items.get(item.id) ?? item
      if (action === 'lock') {
        // Re-uploading needs it open; it locks again on its own after a few idle minutes
        await lockItem(drive, fresh, next, reencrypt)
        if (reencrypt) onReencrypt?.(fresh)
        toast(`Locked “${item.name}”`)
      } else if (action === 'unlock') {
        await unlockItem(drive, fresh, current)
        onUnlocked?.(useDrive.getState().drive.items.get(item.id) ?? fresh)
      } else if (action === 'remove') {
        await removeLock(drive, fresh)
        toast(`Removed the lock from “${item.name}”`)
      } else {
        await changeItemPassword(drive, fresh, current, next)
        toast('Password changed')
      }
      onClose()
    } catch (err) {
      setError(err instanceof WrongPasswordError ? `Wrong ${what} password` : err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const titles: Record<LockAction, string> = {
    lock: `Lock this ${what}`,
    unlock: placeholderName ? `Unlock this ${what}` : `Unlock ${item.name}`,
    remove: 'Remove the lock',
    change: `Change the ${what} password`,
  }
  const valid =
    (!needsAccount || account.length > 0) &&
    (action !== 'unlock' && action !== 'change' ? true : current.length > 0) &&
    (!needsNew || (next.length >= MIN_PASSWORD && next === repeat))

  return (
    <Dialog
      title={titles[action]}
      icon={action === 'unlock' || action === 'remove' ? LockOpen : action === 'change' ? KeyRound : Lock}
      alert
      subtitle={action === 'lock' ? "Only this password opens it. It can't be recovered." : undefined}
      onClose={onClose}
      wide={action === 'lock'}
    >
      <form onSubmit={run} className="space-y-4 text-sm">
        {action === 'lock' && (
          <p className="leading-relaxed text-muted">
            {item.kind === 'folder'
              ? 'The folder and everything in it will need this password. Its name and contents are hidden until it is unlocked.'
              : 'The file will need this password to open. Its name and preview are hidden until it is unlocked.'}{' '}
            Locked items can't be sent to chats.
          </p>
        )}
        {action === 'remove' && (
          <p className="leading-relaxed text-muted">
            “{item.name}” will open without its own password again (it stays encrypted with your TeleDrive password).
          </p>
        )}

        {needsAccount && (
          <PasswordField
            label="TeleDrive password"
            kind="account"
            hint="To confirm it's you"
            value={account}
            onChange={setAccount}
            autoFocus
            autoComplete="current-password"
          />
        )}
        {(action === 'unlock' || action === 'change') && (
          <PasswordField
            label={action === 'unlock' ? `${what === 'folder' ? 'Folder' : 'File'} password` : `Current ${what} password`}
            value={current}
            onChange={setCurrent}
            autoFocus={!needsAccount}
            autoComplete="off"
            error={!!error && action === 'unlock'}
          />
        )}
        {needsNew && (
          <>
            <PasswordField
              label={`New ${what} password`}
              hint={`At least ${MIN_PASSWORD} characters`}
              value={next}
              onChange={setNext}
              autoComplete="new-password"
            />
            <PasswordField
              label="Repeat it"
              value={repeat}
              onChange={setRepeat}
              autoComplete="new-password"
              error={repeat.length > 0 && repeat !== next}
            />
            {repeat.length > 0 && repeat !== next && <ErrorText>The passwords don't match</ErrorText>}
          </>
        )}

        {action === 'lock' && (
          <>
            <fieldset className="space-y-3 pt-1">
              <legend className="field-label">How to lock</legend>
              <Choice name="lock-how" checked={!reencrypt} onChange={() => setReencrypt(false)} label="Lock now" hint="Instant." />
              <Choice
                name="lock-how"
                checked={reencrypt}
                onChange={() => setReencrypt(true)}
                label="Lock and re-encrypt"
                hint="Most secure: uploads the files again with new keys, so older copies Telegram may keep can't be opened with your TeleDrive password alone. Takes as long as uploading them."
              />
            </fieldset>
            <Note>
              If you forget this password, the {what} can't be opened. There's no way to recover it.
            </Note>
          </>
        )}

        {error && <ErrorText>{error}</ErrorText>}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy || !valid}>
            {busy ? (
              <Loader2 className="animate-spin" />
            ) : action === 'unlock' || action === 'remove' ? (
              <LockOpen />
            ) : action === 'lock' ? (
              <Lock />
            ) : (
              <KeyRound />
            )}
            {{ lock: `Lock ${what}`, unlock: 'Unlock', remove: 'Remove lock', change: 'Change password' }[action]}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
