import { ChevronRight, Folder, HardDrive, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { ROOT } from '../../drive/meta'
import { breadcrumbs, isDescendant, listFolder, type Drive, type Item } from '../../drive/tree'
import { useRootName } from '../../store/useDrive'
import Dialog from '../Dialog'

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

  const blocked = (id: string) => items.some((i) => i.kind === 'folder' && isDescendant(drive, id, i.id))
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
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy || alreadyThere || blocked(current)} onClick={submit}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {props.confirmLabel ?? 'Move here'}
          </button>
        </>
      }
    >
      <nav className="mb-2 flex flex-wrap items-center gap-1 text-sm">
        <button className="rounded px-1.5 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setCurrent(ROOT)}>
          {rootName}
        </button>
        {breadcrumbs(drive, current).map((f) => (
          <span key={f.id} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
            <button className="rounded px-1.5 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setCurrent(f.id)}>
              {f.name}
            </button>
          </span>
        ))}
      </nav>
      <div className="min-h-48 rounded-lg border border-slate-200 dark:border-slate-800">
        {folders.length === 0 && (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-sm text-slate-400">
            <HardDrive className="h-6 w-6" /> No folders here
          </div>
        )}
        {folders.map((f) => (
          <button
            key={f.id}
            disabled={blocked(f.id)}
            onClick={() => setCurrent(f.id)}
            className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-slate-50 disabled:opacity-40 dark:hover:bg-slate-800/60"
          >
            <Folder className="h-5 w-5 shrink-0 text-amber-500" />
            <span className="flex-1 truncate">{f.name}</span>
            <ChevronRight className="h-4 w-4 text-slate-400" />
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Dialog>
  )
}
