import { nanoid } from 'nanoid'
import { CanceledError, TransferControl } from './transfer'

export type TransferStatus = 'queued' | 'running' | 'paused' | 'done' | 'error' | 'canceled'

export interface Transfer {
  id: string
  kind: 'upload' | 'download'
  name: string
  size: number
  done: number
  status: TransferStatus
  error?: string
  /** Bytes per second (smoothed). */
  speed: number
}

type Job = (ctl: TransferControl) => Promise<void>
type Listener = (transfers: Transfer[]) => void

const MAX_CONCURRENT = 2

const transfers: Transfer[] = []
const jobs = new Map<string, Job>()
/** Cleanup to run if a failed or waiting transfer is canceled (e.g. discard saved upload progress). */
const discards = new Map<string, () => Promise<void>>()
const controls = new Map<string, TransferControl>()
const listeners = new Set<Listener>()
let emitScheduled = false

export function subscribeTransfers(fn: Listener): () => void {
  listeners.add(fn)
  fn([...transfers])
  return () => listeners.delete(fn)
}

// Progress fires very often; batch UI updates to one per animation frame
function emit() {
  if (emitScheduled) return
  emitScheduled = true
  requestAnimationFrame(() => {
    emitScheduled = false
    const snapshot = transfers.map((t) => ({ ...t }))
    for (const fn of listeners) fn(snapshot)
  })
}

export function enqueue(
  kind: Transfer['kind'], name: string, size: number, job: Job, onDiscard?: () => Promise<void>,
): string {
  const id = nanoid(8)
  transfers.push({ id, kind, name, size, done: 0, status: 'queued', speed: 0 })
  jobs.set(id, job)
  if (onDiscard) discards.set(id, onDiscard)
  emit()
  pump()
  return id
}

function find(id: string) {
  return transfers.find((t) => t.id === id)
}

function pump() {
  const active = transfers.filter((t) => t.status === 'running' || t.status === 'paused').length
  const waiting = transfers.filter((t) => t.status === 'queued')
  for (const t of waiting.slice(0, Math.max(0, MAX_CONCURRENT - active))) void run(t)
}

async function run(t: Transfer) {
  const job = jobs.get(t.id)!
  t.status = 'running'
  let windowStart = performance.now()
  let windowBytes = 0
  const ctl = new TransferControl((n) => {
    t.done += n
    windowBytes += n
    const elapsed = performance.now() - windowStart
    if (elapsed > 1000) {
      const rate = (windowBytes * 1000) / elapsed
      t.speed = t.speed ? t.speed * 0.6 + rate * 0.4 : rate
      windowStart = performance.now()
      windowBytes = 0
    }
    emit()
  })
  controls.set(t.id, ctl)
  emit()
  try {
    await job(ctl)
    t.status = 'done'
    t.done = t.size
  } catch (e) {
    if (e instanceof CanceledError || ctl.canceled) t.status = 'canceled'
    else {
      t.status = 'error'
      t.error = e instanceof Error ? e.message : String(e)
      console.error(`Transfer failed: ${t.name}`, e)
    }
  } finally {
    t.speed = 0
    controls.delete(t.id)
    // Failed jobs are kept so they can be retried
    if (t.status !== 'error') {
      jobs.delete(t.id)
      discards.delete(t.id)
    }
    emit()
    pump()
  }
}

export function pauseTransfer(id: string) {
  const t = find(id)
  if (t?.status !== 'running') return
  controls.get(id)?.pause()
  t.status = 'paused'
  t.speed = 0
  emit()
}

export function resumeTransfer(id: string) {
  const t = find(id)
  if (t?.status !== 'paused') return
  controls.get(id)?.resume()
  t.status = 'running'
  emit()
}

export function cancelTransfer(id: string) {
  const t = find(id)
  if (!t) return
  if (t.status === 'queued' || t.status === 'error') {
    t.status = 'canceled'
    jobs.delete(id)
    discards.get(id)?.().catch((e) => console.error('Discard failed', e))
    discards.delete(id)
  } else controls.get(id)?.cancel()
  emit()
}

/** Run a failed transfer again (uploads continue from where they stopped). */
export function retryTransfer(id: string) {
  const t = find(id)
  if (t?.status !== 'error' || !jobs.has(id)) return
  t.status = 'queued'
  t.done = 0
  t.error = undefined
  emit()
  pump()
}

/** Remove finished/failed/canceled entries from the list. */
export function clearFinished() {
  for (let i = transfers.length - 1; i >= 0; i--) {
    if (!['queued', 'running', 'paused'].includes(transfers[i].status)) {
      jobs.delete(transfers[i].id)
      discards.delete(transfers[i].id)
      transfers.splice(i, 1)
    }
  }
  emit()
}
