import { Download, FileCheck, FileUp, KeyRound, Loader2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { WrongPasswordError } from '../../drive/crypto'
import { pickSaveTarget } from '../../drive/download'
import { newVaultId, useVault } from '../../store/useVault'
import { toast, toastError } from '../../store/useToast'
import { exportName, isProtected, protect, toBitwardenJson, toCsv, unprotect } from '../../vault/exporters'
import { importFile, isDuplicate, SOURCES, type Imported, type ImportSource } from '../../vault/importers'
import { TYPE_NAMES, type ItemType } from '../../vault/items'
import Dialog from '../Dialog'
import { Choice, ErrorText, Note, PasswordField } from '../ui'

const counts = (items: { ty: ItemType }[]) =>
  (['login', 'card', 'identity', 'note'] as const)
    .map((t) => [t, items.filter((i) => i.ty === t).length] as const)
    .filter(([, n]) => n)
    .map(([t, n]) => `${n} ${n === 1 ? TYPE_NAMES[t].one.toLowerCase() : TYPE_NAMES[t].many.toLowerCase()}`)
    .join(', ')

/** Import passwords: source → file (→ file password) → summary → import. */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const existing = useVault((s) => s.items)
  const [source, setSource] = useState<ImportSource>('bitwarden-json')
  const [file, setFile] = useState<{ name: string; text: string } | null>(null)
  const [filePassword, setFilePassword] = useState('')
  const [result, setResult] = useState<Imported | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const meta = SOURCES.find((s) => s.id === source)!
  const locked = file && source === 'bitwarden-json' && isProtected(file.text)

  const read = async (f: { name: string; text: string }, password?: string) => {
    setError(null)
    try {
      const text = source === 'bitwarden-json' && isProtected(f.text) ? (password ? await unprotect(f.text, password) : null) : f.text
      setResult(text === null ? null : importFile(source, text))
    } catch (e) {
      setResult(null)
      setError(e instanceof WrongPasswordError ? 'Wrong file password' : e instanceof Error ? e.message : String(e))
    }
  }

  const pick = async (f: File) => {
    const loaded = { name: f.name, text: await f.text() }
    setFile(loaded)
    setFilePassword('')
    void read(loaded)
  }

  const fresh = result ? result.items.filter((i) => !isDuplicate(i, existing)) : []

  const run = async () => {
    if (!result) return
    setBusy(true)
    const vault = useVault.getState()
    try {
      // Folders: an existing one with the same name is reused
      const folderIds = new Map<string, string>()
      for (const name of result.folders) {
        const found = useVault.getState().folders.find((f) => f.n.toLowerCase() === name.toLowerCase())
        if (found) folderIds.set(name, found.id)
        else {
          const id = newVaultId()
          await vault.saveFolder({ id, n: name, rd: Date.now() })
          folderIds.set(name, id)
        }
      }
      let n = 0
      for (const item of fresh) {
        setProgress(`Importing ${++n} of ${fresh.length}…`)
        await vault.save({ ...item, id: newVaultId(), f: item.f ? folderIds.get(item.f) : undefined })
      }
      toast(`Imported ${fresh.length} item${fresh.length === 1 ? '' : 's'}`)
      onClose()
    } catch (e) {
      toastError(e)
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <Dialog
      title="Import passwords"
      subtitle={result ? 'Step 2 of 2' : 'Step 1 of 2'}
      icon={Download}
      wide
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <button className="btn-ghost" disabled={busy} onClick={onClose}>Cancel</button>
          {result ? (
            <button className="btn-primary" disabled={busy || !fresh.length} onClick={() => void run()}>
              {busy ? <Loader2 className="animate-spin" /> : <Download />} {progress ?? `Import ${fresh.length} item${fresh.length === 1 ? '' : 's'}`}
            </button>
          ) : (
            locked && (
              <button className="btn-primary" disabled={!filePassword} onClick={() => file && void read(file, filePassword)}>
                Open file
              </button>
            )
          )}
        </>
      }
    >
      <div className="space-y-4 pb-1">
        {!result && (
          <>
            <p className="field-label">Where are they now?</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {SOURCES.map((s) => (
                <Choice
                  key={s.id}
                  name="source"
                  label={`${s.label} (${s.ext})`}
                  checked={source === s.id}
                  onChange={() => {
                    setSource(s.id)
                    setFile(null)
                    setError(null)
                  }}
                />
              ))}
            </div>
            <p className="text-xs text-muted">In {meta.label}: {meta.hint}</p>
            <input ref={input} type="file" hidden accept={`${meta.ext},text/*,application/json,application/xml`} onChange={(e) => (e.target.files?.[0] && void pick(e.target.files[0]), (e.target.value = ''))} />
            <button
              className="flex w-full flex-col items-center gap-2 rounded-md px-6 py-6 text-center pressed-lg"
              onClick={() => input.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const f = e.dataTransfer.files[0]
                if (f) void pick(f)
              }}
            >
              <span className="flex size-13 items-center justify-center rounded-md raised">{file ? <FileCheck /> : <FileUp />}</span>
              <span className="font-bold">{file ? file.name : `Choose your ${meta.label} export (${meta.ext})`}</span>
              <span className="text-xs text-muted">{file ? 'Choose another' : 'Or drop it here'}</span>
            </button>
            {locked && (
              <PasswordField label="File password" value={filePassword} onChange={setFilePassword} icon={KeyRound} autoComplete="off" autoFocus hint="This export is protected with a password." />
            )}
          </>
        )}
        {result && (
          <>
            <div className="flex items-center gap-3 rounded-md p-4 pressed">
              <FileCheck className="size-5 shrink-0" />
              <div className="min-w-0">
                <p className="truncate font-bold">{file?.name}</p>
                <p className="text-xs text-muted">
                  {result.items.length} item{result.items.length === 1 ? '' : 's'}: {counts(result.items) || 'none'}
                  {result.folders.length ? ` · ${result.folders.length} folder${result.folders.length === 1 ? '' : 's'}` : ''}
                </p>
              </div>
            </div>
            {result.items.length - fresh.length > 0 && (
              <p className="text-sm">{result.items.length - fresh.length} already in TeleWarden (same name, username and website) will be skipped.</p>
            )}
            {!locked && (
              <Note>This file isn’t encrypted. Delete it after importing.</Note>
            )}
            <button className="btn-ghost -ml-2 h-9 px-2" disabled={busy} onClick={() => (setResult(null), setFile(null))}>
              Choose another file
            </button>
          </>
        )}
        {error && <ErrorText>{error}</ErrorText>}
      </div>
    </Dialog>
  )
}

type Format = 'protected' | 'json' | 'csv'

/** Export the vault: master password first, then a format (a file password for the protected one). */
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const [format, setFormat] = useState<Format>('protected')
  const [master, setMaster] = useState('')
  const [filePassword, setFilePassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const count = useVault((s) => s.items.filter((i) => !i.tr).length)
  const fileOk = format !== 'protected' || (filePassword.length >= 8 && filePassword === repeat)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      if (!(await useVault.getState().checkPassword(master))) throw new WrongPasswordError()
      const { items, folders } = useVault.getState()
      const json = JSON.stringify(toBitwardenJson(items, folders), null, 2)
      const text = format === 'csv' ? toCsv(items, folders) : format === 'json' ? json : await protect(json, filePassword)
      const name = exportName(format === 'csv' ? 'csv' : 'json')
      const target = await pickSaveTarget({ name, mime: format === 'csv' ? 'text/csv' : 'application/json' })
      if (!target) return setBusy(false)
      await target.write(new TextEncoder().encode(text))
      await target.close()
      toast(`Exported ${name}`)
      onClose()
    } catch (e) {
      setError(e instanceof WrongPasswordError ? 'Wrong master password' : e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Dialog
      title="Export vault"
      subtitle={`${count} item${count === 1 ? '' : 's'}`}
      icon={Upload}
      alert
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || !master || !fileOk} onClick={() => void run()}>
            {busy ? <Loader2 className="animate-spin" /> : <Upload />} Export
          </button>
        </>
      }
    >
      <div className="space-y-4 pb-1">
        <div className="space-y-2">
          <Choice name="format" label="Password-protected file (.json)" hint="Safe to keep anywhere. Opens in TeleWarden or Bitwarden with the file password." checked={format === 'protected'} onChange={() => setFormat('protected')} />
          <Choice name="format" label="Plain file (.json)" hint="Everything, readable by anyone who gets the file." checked={format === 'json'} onChange={() => setFormat('json')} />
          <Choice name="format" label="Spreadsheet (.csv)" hint="Logins and notes only, readable by anyone who gets the file." checked={format === 'csv'} onChange={() => setFormat('csv')} />
        </div>
        {format === 'protected' ? (
          <>
            <PasswordField label="File password" value={filePassword} onChange={setFilePassword} icon={KeyRound} autoComplete="new-password" hint="At least 8 characters. You’ll need it to open the file; it can’t be recovered." />
            <PasswordField label="Type it again" value={repeat} onChange={setRepeat} icon={KeyRound} autoComplete="new-password" error={!!repeat && repeat !== filePassword} />
          </>
        ) : (
          <Note>Plain exports contain every password in readable text. Delete the file when you’re done with it.</Note>
        )}
        <PasswordField label="Master password" value={master} onChange={setMaster} icon={KeyRound} autoComplete="current-password" />
        {error && <ErrorText>{error}</ErrorText>}
      </div>
    </Dialog>
  )
}
