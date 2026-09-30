import { Copy } from 'lucide-react'
import type { FileItem } from '../../drive/tree'
import Dialog from '../Dialog'

const SHOWN = 5

export interface Duplicate {
  name: string
  existing: FileItem
  location: string
}

/** Warns that some files being uploaded are already in the drive. */
export default function DuplicatesDialog(props: {
  duplicates: Duplicate[]
  total: number
  onSkip: () => void
  onUploadAll: () => void
  onClose: () => void
}) {
  const { duplicates, total, onSkip, onUploadAll, onClose } = props
  const one = duplicates.length === 1
  const allDupes = duplicates.length === total

  return (
    <Dialog
      title={one ? 'Already in your drive' : `${duplicates.length} files are already in your drive`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn-ghost" onClick={onUploadAll}>
            Upload anyway
          </button>
          <button className="btn-primary" onClick={onSkip}>
            {allDupes ? "Don't upload" : one ? 'Skip it' : 'Skip these'}
          </button>
        </>
      }
    >
      <ul className="space-y-2 pb-2 text-sm">
        {duplicates.slice(0, SHOWN).map((d, i) => (
          <li key={i} className="flex gap-2">
            <Copy className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <span className="min-w-0">
              <span className="font-medium break-all">{d.name}</span>
              <span className="block text-slate-500">
                {d.existing.name === d.name ? 'Already in' : `Same as “${d.existing.name}” in`} {d.location}
              </span>
            </span>
          </li>
        ))}
        {duplicates.length > SHOWN && <li className="text-slate-500">and {duplicates.length - SHOWN} more</li>}
      </ul>
      {!allDupes && <p className="pb-2 text-sm text-slate-500">The other {total - duplicates.length} will be uploaded either way.</p>}
    </Dialog>
  )
}
