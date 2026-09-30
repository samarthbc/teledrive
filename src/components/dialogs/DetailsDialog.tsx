import { Download } from 'lucide-react'
import { ROOT } from '../../drive/meta'
import { breadcrumbs, collectTree, type Drive, type Item } from '../../drive/tree'
import { fileIcon, formatBytes } from '../../lib/format'
import { useRootName } from '../../store/useDrive'
import Dialog from '../Dialog'

export default function DetailsDialog(props: { drive: Drive; item: Item; onDownload: () => void; onClose: () => void }) {
  const { drive, item, onDownload, onClose } = props
  const { Icon, color } = fileIcon(item)
  const rootName = useRootName()
  const location = item.parent === ROOT ? rootName : [rootName, ...breadcrumbs(drive, item.parent).map((f) => f.name)].join(' / ')

  const rows: [string, string][] = [['Location', location], ['Created', new Date(item.ts * 1000).toLocaleString()]]
  if (item.x.enc) rows.push(['Encryption', item.locked ? 'Encrypted (locked on this device)' : 'End-to-end encrypted'])
  if (item.kind === 'file') {
    rows.unshift(['Size', `${formatBytes(item.size)} (${item.size.toLocaleString()} bytes)`], ['Type', item.mime])
    rows.push(['Stored as', item.partsTotal === 1 ? '1 Telegram message' : `${item.partsTotal} Telegram messages`])
    if (!item.complete) rows.push(['Status', `Incomplete: ${item.parts.length} of ${item.partsTotal} parts found`])
  } else {
    const contents = collectTree(drive, item.id).filter((i) => i.id !== item.id)
    const files = contents.filter((i) => i.kind === 'file')
    const bytes = files.reduce((n, f) => n + (f.kind === 'file' ? f.size : 0), 0)
    rows.unshift(['Contains', `${files.length} files, ${contents.length - files.length} folders (${formatBytes(bytes)})`])
  }

  return (
    <Dialog
      title="Details"
      onClose={onClose}
      footer={
        item.kind === 'file' && item.complete && !item.locked ? (
          <button className="btn-primary" onClick={onDownload}>
            <Download className="h-4 w-4" /> Download
          </button>
        ) : undefined
      }
    >
      <div className="mb-4 flex items-center gap-3">
        <Icon className={`h-10 w-10 shrink-0 ${color}`} strokeWidth={1.5} />
        <p className="font-medium break-all">{item.name}</p>
      </div>
      <dl className="space-y-2 pb-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[6.5rem_1fr] gap-2">
            <dt className="text-slate-500">{k}</dt>
            <dd className="break-words">{v}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  )
}
