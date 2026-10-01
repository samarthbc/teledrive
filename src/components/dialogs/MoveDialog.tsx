import { ChevronRight, Folder, FolderInput, HardDrive, Loader2, Lock } from 'lucide-react'
import { useState } from 'react'
import { ROOT } from '../../drive/meta'
import { breadcrumbs, isDescendant, listFolder, type Drive, type Item } from '../../drive/tree'
import { useRootName } from '../../store/useDrive'
import Dialog from '../Dialog'
import { ErrorText } from '../ui'

/** Browse folders and pick a destination. */
export default function MoveDialog(props: {
  drive: Drive
  items: Item[]
  onMove: (targetId: string) => Promise<void>
  onClose: () => void
  /** Overrides for using this as a general folder picker (e.g. "Save to TeleDrive"). */
  title?: string
  confirmLabel?: string
  initialFolder?: string
}) {
  const { drive, items, onMove, onClose } = props
  const rootName = useRootName()
  const [current, setCurrent] = useState(items[0]?.parent ?? props.initialFolder ?? ROOT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Can't go into itself, or into a locked folder that isn't unlocked
  const blocked = (id: string) =>
    !!drive.items.get(id)?.locked || items.some((i) => i.kind === 'folder' && isDescendant(drive, id, i.id))
  const folders = listFolder(drive, current)
    .filter((i) => i.kind === 'folder')
    .sort((a, b) => a.name.localeCompare(b.name))
  const alreadyThere = items.length > 0 && items.every((i) => i.parent === current)

  const submit = async () => {
    setBusy(true)
    try {
      await onMove(current)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const title = props.title ?? (items.length === 1 ? `Move “${items[0].name}”` : `Move ${items.length} items`)
  return (
    <Dialog
      title={title}
      icon={FolderInput}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy || alreadyThere || blocked(current)} onClick={submit}>
            {busy && <Loader2 className="animate-spin" />}
            {props.confirmLabel ?? 'Move here'}
          </button>
        </>
      }
    >
      <nav className="mb-3 flex flex-wrap items-center gap-1.5 text-[15px] font-bold" aria-label="Folders">
        {[{ id: ROOT, name: rootName }, ...breadcrumbs(drive, current)].map((f, i, all) => (
          <span key={f.id} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-brand-ink">/</span>}
            <button className={`rounded-md ${i === all.length - 1 ? 'text-ink' : 'text-muted hover:text-ink'}`} onClick={() => setCurrent(f.id)}>
              {f.name}
            </button>
          </span>
        ))}
      </nav>
      <div className="min-h-48 space-y-1 rounded-md p-1.5 pressed">
        {folders.length === 0 && (
          <div className="flex h-45 flex-col items-center justify-center gap-2 text-sm text-muted">
            <HardDrive className="size-6" strokeWidth={1.6} /> No folders here
          </div>
        )}
        {folders.map((f) => (
          <button
            key={f.id}
            disabled={blocked(f.id)}
            onClick={() => setCurrent(f.id)}
            className="flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-semibold hover:bg-surface hover:raised-xs disabled:opacity-40 disabled:hover:shadow-none"
          >
            {f.locked ? <Lock className="size-4.5 shrink-0 text-brand-ink" /> : <Folder className="size-4.5 shrink-0" />}
            <span className="flex-1 truncate">{f.name}</span>
            <ChevronRight className="size-4 text-muted" />
          </button>
        ))}
      </div>
      {error && (
        <div className="mt-3">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </Dialog>
  )
}
