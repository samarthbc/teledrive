import { KeyRound, Loader2, Lock, LockOpen } from 'lucide-react'
import { useState } from 'react'
import { WrongPasswordError } from '../../drive/crypto'
import { changeItemPassword, lockItem, removeLock, unlockItem } from '../../drive/ops'
import type { Item } from '../../drive/tree'
import { verifyPassword } from '../../drive/vault'
import { MIN_PASSWORD } from '../../pages/Password'
import { useDrive } from '../../store/useDrive'
import { toast } from '../../store/useToast'
import Dialog from '../Dialog'

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
    unlock: `Unlock “${item.locked ? `this ${what}` : item.name}”`,
    remove: 'Remove the lock',
    change: `Change the ${what} password`,
  }
  const valid =
    (!needsAccount || account.length > 0) &&
    (action !== 'unlock' && action !== 'change' ? true : current.length > 0) &&
    (!needsNew || (next.length >= MIN_PASSWORD && next === repeat))

  return (
    <Dialog title={titles[action]} onClose={onClose} wide={action === 'lock'}>
      <form onSubmit={run} className="space-y-3 pb-4 text-sm">
        {action === 'lock' && (
          <p className="text-slate-600 dark:text-slate-400">
            {item.kind === 'folder'
              ? 'The folder and everything in it will need this password. Its name and contents are hidden until it is unlocked.'
              : 'The file will need this password to open. Its name and preview are hidden until it is unlocked.'}{' '}
            Locked items can't be sent to chats.
          </p>
        )}
        {action === 'remove' && (
          <p className="text-slate-600 dark:text-slate-400">
            “{item.name}” will open without its own password again (it stays encrypted with your TeleDrive password).
          </p>
        )}

        {needsAccount && (
          <Field label="Your TeleDrive password (to confirm it's you)" value={account} onChange={setAccount} autoFocus autoComplete="current-password" />
        )}
        {(action === 'unlock' || action === 'change') && (
          <Field
            label={action === 'unlock' ? `${what === 'folder' ? 'Folder' : 'File'} password` : `Current ${what} password`}
            value={current} onChange={setCurrent} autoFocus={!needsAccount} autoComplete="off"
          />
        )}
        {needsNew && (
          <>
            <Field label={`New ${what} password (at least ${MIN_PASSWORD} characters)`} value={next} onChange={setNext} autoComplete="new-password" />
            <Field label="Repeat it" value={repeat} onChange={setRepeat} autoComplete="new-password" />
            {repeat.length > 0 && repeat !== next && <p className="text-red-600">The passwords don't match</p>}
          </>
        )}

        {action === 'lock' && (
          <>
            <fieldset className="space-y-2">
              <Choice checked={!reencrypt} onChange={() => setReencrypt(false)} label="Lock now" hint="Instant." />
              <Choice
                checked={reencrypt}
                onChange={() => setReencrypt(true)}
                label="Lock and re-encrypt"
                hint="Most secure: uploads the files again with new keys, so older copies Telegram may keep can't be opened with your TeleDrive password alone. Takes as long as uploading them."
              />
            </fieldset>
            <p className="rounded-lg bg-amber-50 p-3 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              If you forget this password, the {what} can't be opened. There's no way to recover it.
            </p>
          </>
        )}

        {error && <p className="text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy || !valid}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : action === 'unlock' || action === 'remove' ? (
              <LockOpen className="h-4 w-4" />
            ) : action === 'lock' ? (
              <Lock className="h-4 w-4" />
            ) : (
              <KeyRound className="h-4 w-4" />
            )}
            {{ lock: 'Lock', unlock: 'Unlock', remove: 'Remove lock', change: 'Change password' }[action]}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function Field(props: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; autoComplete: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-slate-600 dark:text-slate-400">{props.label}</span>
      <input
        className="input" type="password" autoFocus={props.autoFocus} autoComplete={props.autoComplete}
        value={props.value} onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  )
}

function Choice(props: { label: string; hint: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <input type="radio" className="mt-1 accent-brand" checked={props.checked} onChange={props.onChange} />
      <span>
        <span className="block font-medium">{props.label}</span>
        <span className="block text-xs text-slate-500">{props.hint}</span>
      </span>
    </label>
  )
}
