import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronUp, Pause, Play, RotateCcw, X } from 'lucide-react'
import { useState } from 'react'
import { cancelTransfer, clearFinished, pauseTransfer, resumeTransfer, retryTransfer, type Transfer } from '../drive/queue'
import { formatBytes, formatDuration } from '../lib/format'
import { useDrive } from '../store/useDrive'

const ACTIVE = ['queued', 'running', 'paused']

export default function TransferPanel() {
  const transfers = useDrive((s) => s.transfers)
  const [collapsed, setCollapsed] = useState(false)
  if (!transfers.length) return null

  const active = transfers.filter((t) => ACTIVE.includes(t.status))
  const failed = transfers.filter((t) => t.status === 'error').length
  const title = active.length
    ? `${active.length} transfer${active.length > 1 ? 's' : ''} in progress`
    : failed
      ? `${failed} transfer${failed > 1 ? 's' : ''} failed`
      : 'Transfers complete'

  return (
    <div className="card fixed right-0 bottom-0 left-0 z-30 overflow-hidden rounded-b-none shadow-2xl sm:right-4 sm:bottom-4 sm:left-auto sm:w-96 sm:rounded-2xl">
      <div className="flex items-center gap-2 bg-slate-100 px-4 py-2.5 dark:bg-slate-800">
        <span className="flex-1 text-sm font-medium">{title}</span>
        {!active.length && (
          <button className="icon-btn h-8 w-8" onClick={clearFinished} aria-label="Clear">
            <X className="h-4 w-4" />
          </button>
        )}
        <button className="icon-btn h-8 w-8" onClick={() => setCollapsed(!collapsed)} aria-label="Toggle">
          {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>
      {!collapsed && (
        <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
          {[...transfers].reverse().map((t) => (
            <Row key={t.id} t={t} />
          ))}
        </ul>
      )}
    </div>
  )
}

function Row({ t }: { t: Transfer }) {
  const pct = t.size ? Math.min(100, (t.done / t.size) * 100) : 0
  const Dir = t.kind === 'upload' ? ArrowUp : ArrowDown
  const eta = t.speed ? formatDuration((t.size - t.done) / t.speed) : ''
  const status: Record<Transfer['status'], string> = {
    queued: 'Waiting…',
    running: `${formatBytes(t.done)} of ${formatBytes(t.size)}${t.speed ? ` · ${formatBytes(t.speed)}/s` : ''}${eta ? ` · ${eta} left` : ''}`,
    paused: `Paused · ${formatBytes(t.done)} of ${formatBytes(t.size)}`,
    done: `${t.kind === 'upload' ? 'Uploaded' : 'Downloaded'} · ${formatBytes(t.size)}`,
    error: t.error ?? 'Failed',
    canceled: 'Canceled',
  }

  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <Dir className="h-4 w-4 shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{t.name}</p>
        <p className={`truncate text-xs ${t.status === 'error' ? 'text-red-600' : 'text-slate-500'}`}>{status[t.status]}</p>
        {ACTIVE.includes(t.status) && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div
              className={`h-full rounded-full transition-[width] ${t.status === 'paused' ? 'bg-slate-400' : 'bg-brand'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>
      {t.status === 'running' && (
        <button className="icon-btn h-8 w-8" onClick={() => pauseTransfer(t.id)} aria-label="Pause">
          <Pause className="h-4 w-4" />
        </button>
      )}
      {t.status === 'paused' && (
        <button className="icon-btn h-8 w-8" onClick={() => resumeTransfer(t.id)} aria-label="Resume">
          <Play className="h-4 w-4" />
        </button>
      )}
      {t.status === 'error' && (
        <button className="icon-btn h-8 w-8" onClick={() => retryTransfer(t.id)} aria-label="Retry" title="Retry">
          <RotateCcw className="h-4 w-4" />
        </button>
      )}
      {(ACTIVE.includes(t.status) || t.status === 'error') && (
        <button className="icon-btn h-8 w-8" onClick={() => cancelTransfer(t.id)} aria-label="Cancel">
          <X className="h-4 w-4" />
        </button>
      )}
      {t.status === 'done' && <Check className="h-4 w-4 text-emerald-500" />}
    </li>
  )
}
