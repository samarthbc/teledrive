import { KeyRound, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { create } from 'zustand'
import { isAndroid, isHeadless, Native, type AutofillSave } from '../../native/android'
import { useDrive } from '../../store/useDrive'
import { toast, toastError } from '../../store/useToast'
import { newVaultId, useVault } from '../../store/useVault'
import { blankItem, type LoginItem } from '../../vault/items'
import { baseDomain, hostOf, matchingLogins, targetLabel, targetUrl, type FillTarget } from '../../vault/match'
import Dialog from '../Dialog'
import { PasswordField } from '../ui'
import { TextField } from './parts'

// "Save to TeleWarden?" (IMPLEMENTATION.md → "Phase 23"): after signing in somewhere, Android's save prompt hands the
// login to TeleDrive (TeleWardenAutofillService → MainActivity). TeleWarden opens; once it's unlocked, this asks to
// save it, or to update the password of the login already saved with that username.

export const usePendingSave = create<{ save: AutofillSave | null }>(() => ({ save: null }))

/** Android app: pick up a login to save (when TeleDrive starts from the save prompt, and while it runs). */
export function initAutofillSave(): void {
  if (!isAndroid || isHeadless) return
  const take = async () => {
    const { save } = await Native.takeAutofillSave().catch(() => ({ save: undefined }))
    if (!save?.password) return
    usePendingSave.setState({ save })
    // Open TeleWarden once the app is ready (its lock screen comes first)
    const open = () => void useDrive.getState().openVault().catch(toastError)
    if (useDrive.getState().phase === 'ready') open()
    else {
      const stop = useDrive.subscribe((s) => {
        if (s.phase !== 'ready') return
        stop()
        open()
      })
    }
  }
  void Native.addListener('autofillSave', () => void take())
  void take()
}

const targetOf = (s: AutofillSave): FillTarget => (s.kind === 'app' ? { app: s.target } : { web: s.target })

/** A name for a new login: the app's name, or the site ("instagram.com" → "Instagram"). */
function nameFor(s: AutofillSave): string {
  if (s.kind === 'app') return s.label || s.target
  const site = baseDomain(hostOf(s.target) || s.target).split('.')[0] ?? s.target
  return site.charAt(0).toUpperCase() + site.slice(1)
}

export function SaveLoginDialog() {
  const save = usePendingSave((s) => s.save)
  const items = useVault((s) => s.items)
  const [name, setName] = useState(() => (save ? nameFor(save) : ''))
  const [username, setUsername] = useState(save?.username ?? '')
  const [password, setPassword] = useState(save?.password ?? '')
  const [busy, setBusy] = useState(false)
  if (!save) return null

  const target = targetOf(save)
  const where = targetLabel(target, save.label)
  const same = matchingLogins(items, target).find((l) => l.d.u.trim().toLowerCase() === username.trim().toLowerCase())
  const unchanged = same && same.d.p === password
  const close = () => usePendingSave.setState({ save: null })

  const run = async () => {
    setBusy(true)
    try {
      if (same) {
        await useVault.getState().save({ ...same, d: { ...same.d, p: password } })
        toast(`Password updated in “${same.n}”`)
      } else {
        const item = blankItem('login', newVaultId()) as LoginItem
        await useVault.getState().save({ ...item, n: name.trim() || where, d: { ...item.d, u: username.trim(), p: password, urls: [{ u: targetUrl(target) }] } })
        toast(`Saved “${name.trim() || where}” to TeleWarden`)
      }
      close()
    } catch (e) {
      toastError(e)
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={unchanged ? 'Already saved' : same ? 'Update password in TeleWarden?' : 'Save to TeleWarden?'}
      subtitle={where}
      icon={KeyRound}
      onClose={close}
      footer={
        unchanged ? (
          <button type="button" className="btn-primary" onClick={close}>Done</button>
        ) : (
          <>
            <button type="button" className="btn-ghost" onClick={close}>Not now</button>
            <button type="button" className="btn-primary" disabled={busy || !password} onClick={() => void run()}>
              {busy && <Loader2 className="animate-spin" />} {same ? 'Update' : 'Save'}
            </button>
          </>
        )
      }
    >
      <div className="space-y-4 pb-1">
        {unchanged ? (
          <p className="text-sm">“{same.n}” already has this username and password.</p>
        ) : same ? (
          <p className="text-sm">
            “{same.n}” has <b>{same.d.u || 'no username'}</b> with a different password. The old one is kept in its password history.
          </p>
        ) : (
          <TextField label="Name" value={name} onChange={setName} />
        )}
        {!unchanged && (
          <>
            <TextField label="Username" value={username} onChange={setUsername} />
            <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="off" />
          </>
        )}
      </div>
    </Dialog>
  )
}
