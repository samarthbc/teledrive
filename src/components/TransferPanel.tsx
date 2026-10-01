import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronUp, Pause, Play, RotateCcw, X } from 'lucide-react'
import { useState } from 'react'
import { cancelTransfer, clearFinished, pauseTransfer, resumeTransfer, retryTransfer, type Transfer } from '../drive/queue'
import { formatBytes, formatDuration } from '../lib/format'
import { useDrive } from '../store/useDrive'

const ACTIVE = ['queued', 'running', 'paused']

export default function TransferPanel({ className = '' }: { className?: string }) {
  const transfers = useDrive((s) => s.transfers)
  const [collapsed, setCollapsed] = useState(false)
  if (!transfers.length) return null

  const active = transfers.filter((t) => ACTIVE.includes(t.status))
  const failed = transfers.filter((t) => t.status === 'error').length
  const status = active.length ? `${active.length} active` : failed ? `${failed} failed` : 'All done'

  return (
    <section className={`panel overflow-hidden ${className}`} aria-label="Transfers">
      <div className="flex items-center gap-1 py-2 pr-2 pl-4.5">
        <span className="text-[15px] font-black">Transfers</span>
        <span className={`ml-2 flex-1 text-xs ${failed && !active.length ? 'font-bold text-brand-ink' : 'text-muted'}`}>{status}</span>
        {!active.length && (
          <button className="icon-btn-flat" onClick={clearFinished} aria-label="Clear" title="Clear">
            <X />
          </button>
        )}
        <button className="icon-btn-flat" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Show transfers' : 'Hide transfers'}>
          {collapsed ? <ChevronUp /> : <ChevronDown />}
        </button>
      </div>
      {!collapsed && (
        <ul className="max-h-72 space-y-3 overflow-y-auto px-4.5 pt-1 pb-4.5">
          {[...transfers].reverse().map((t) => (
            <Row key={t.id} t={t} />
          ))}
        </ul>
      )}
    </section>
  )
}

function Row({ t }: { t: Transfer }) {
  const pct = t.size ? Math.min(100, (t.done / t.size) * 100) : 0
  const Dir = t.kind === 'upload' ? ArrowUp : ArrowDown
  const eta = t.speed ? formatDuration((t.size - t.done) / t.speed) : ''
  const status: Record<Transfer['status'], string> = {
    queued: 'Waiting…',
    running: t.note ?? `${formatBytes(t.done)} of ${formatBytes(t.size)}${t.speed ? ` · ${formatBytes(t.speed)}/s` : ''}${eta ? ` · ${eta} left` : ''}`,
    paused: `Paused · ${formatBytes(t.done)} of ${formatBytes(t.size)}`,
    done: `${t.kind === 'upload' ? 'Uploaded' : 'Downloaded'} · ${formatBytes(t.size)}`,
    error: t.error ?? 'Failed',
    canceled: 'Canceled',
  }

  return (
    <li className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-bold">
          <Dir className="size-3.5 shrink-0 text-muted" strokeWidth={2.2} />
          <span className="truncate">{t.name}</span>
          {ACTIVE.includes(t.status) && !t.note && <span className="ml-auto shrink-0 font-semibold text-muted">{Math.floor(pct)}%</span>}
        </p>
        <p className={`mt-0.5 truncate text-xs ${t.status === 'error' ? 'font-semibold text-brand-ink' : 'text-muted'}`}>{status[t.status]}</p>
        {ACTIVE.includes(t.status) && (
          <div className="track mt-2">
            <div
              className={`h-full rounded-md transition-[width] ${t.status === 'paused' ? 'bg-muted' : 'bg-brand'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>
      {t.status === 'running' && (
        <button className="icon-btn-flat" onClick={() => pauseTransfer(t.id)} aria-label="Pause">
          <Pause />
        </button>
      )}
      {t.status === 'paused' && (
        <button className="icon-btn-flat" onClick={() => resumeTransfer(t.id)} aria-label="Resume">
          <Play />
        </button>
      )}
      {t.status === 'error' && (
        <button className="icon-btn-flat" onClick={() => retryTransfer(t.id)} aria-label="Retry" title="Retry">
          <RotateCcw />
        </button>
      )}
      {(ACTIVE.includes(t.status) || t.status === 'error') && (
        <button className="icon-btn-flat" onClick={() => cancelTransfer(t.id)} aria-label="Cancel">
          <X />
        </button>
      )}
      {t.status === 'done' && <Check className="mx-2 size-4 shrink-0 text-ink" strokeWidth={2.5} />}
    </li>
  )
}
