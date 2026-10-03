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
  rows.push([
    'Protection',
    item.lock
      ? item.locked
        ? `Locked with its own password`
        : 'Locked with its own password (unlocked for now)'
      : item.level !== 'root'
        ? 'Inside a locked folder'
        : item.x.enc
          ? 'Encrypted with your TeleDrive password'
          : 'Not encrypted (uploaded before encryption)',
  ])
  if (item.kind === 'file') {
    rows.unshift(['Size', `${formatBytes(item.size)} (${item.size.toLocaleString()} bytes)`], ['Type', item.mime])
    if (item.wh) rows.splice(2, 0, ['Dimensions', `${item.wh[0]} × ${item.wh[1]}`])
    if (item.taken) rows.splice(item.wh ? 3 : 2, 0, ['Taken', new Date(item.taken * 1000).toLocaleString()])
    rows.push(['Stored as', item.partsTotal === 1 ? '1 Telegram message' : `${item.partsTotal} Telegram messages`])
    if (!item.complete) rows.push(['Status', `Incomplete: ${item.parts.length} of ${item.partsTotal} parts found`])
  } else if (item.locked) {
    rows.unshift(['Contains', 'Hidden until unlocked'])
  } else {
    // Contents of locked folders inside stay uncounted
    const contents = collectTree(drive, item.id).filter((i) => i.id !== item.id && !i.concealed)
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
            <Download /> Download
          </button>
        ) : undefined
      }
    >
      <div className="mb-5 flex items-center gap-3.5 border-b-2 border-ink pb-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-surface raised-sm">
          <Icon className={`size-6 ${color}`} />
        </span>
        <p className="text-[15px] font-extrabold break-all">{item.name}</p>
      </div>
      <dl className="space-y-2.5 pb-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[6.5rem_1fr] gap-3">
            <dt className="text-muted">{k}</dt>
            <dd className={`break-words ${k === 'Protection' && item.lock ? 'font-bold text-brand-ink' : 'font-semibold'}`}>{v}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  )
}
