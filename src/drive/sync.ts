import { Api } from 'telegram'
import { driveDb, KEYS } from '../db/db'
import { storageChannel, storagePeer } from '../telegram/channel'
import { getClient } from '../telegram/client'
import { toRecord } from '../telegram/messages'
import type { MessageRecord } from './tree'

type Listener = (records: Map<number, MessageRecord>) => void

const records = new Map<number, MessageRecord>()
const listeners = new Set<Listener>()
let running: Promise<void> = Promise.resolve()

export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getRecord(msgId: number): MessageRecord | undefined {
  return records.get(msgId)
}

function emit() {
  for (const fn of listeners) fn(records)
}

/** Load cached records from IndexedDB (instant startup, works offline). */
export async function loadCache(): Promise<boolean> {
  const db = driveDb()
  const cached = await db.records.toArray()
  records.clear()
  for (const r of cached) records.set(r.msgId, r)
  emit()
  return cached.length > 0 || (await db.get<number>(KEYS.pts)) !== undefined
}

/** Apply messages we just sent or edited ourselves, without waiting for the next sync. */
export async function applyMessages(msgs: Api.TypeMessage[]): Promise<void> {
  const upserts: MessageRecord[] = []
  const removals: number[] = []
  for (const m of msgs) {
    const r = toRecord(m)
    if (r) upserts.push(r)
    else removals.push(m.id)
  }
  await commit(upserts, removals)
}

export async function applyDeleted(msgIds: number[]): Promise<void> {
  await commit([], msgIds)
}

async function commit(upserts: MessageRecord[], removals: number[]) {
  if (!upserts.length && !removals.length) return
  // A message that was changed and later deleted in the same batch stays deleted
  const removed = new Set(removals)
  upserts = upserts.filter((r) => !removed.has(r.msgId))
  for (const id of removals) records.delete(id)
  for (const r of upserts) records.set(r.msgId, r)
  const db = driveDb()
  await db.transaction('rw', db.records, async () => {
    if (removals.length) await db.records.bulkDelete(removals)
    if (upserts.length) await db.records.bulkPut(upserts)
  })
  emit()
}

/** Sync with Telegram: incremental if possible, otherwise a full scan. Calls are serialized. */
export function sync(): Promise<void> {
  running = running.catch(() => {}).then(async () => {
    const pts = await driveDb().get<number>(KEYS.pts)
    if (pts === undefined || !(await syncDifference(pts))) await fullScan()
  })
  return running
}

export function forceFullScan(): Promise<void> {
  running = running.catch(() => {}).then(fullScan)
  return running
}

async function fullScan(): Promise<void> {
  const client = await getClient()
  // Read pts first so changes made during the scan are picked up by the next incremental sync
  const full = await client.invoke(new Api.channels.GetFullChannel({ channel: storageChannel() }))
  const pts = (full.fullChat as Api.ChannelFull).pts

  const fresh = new Map<number, MessageRecord>()
  for await (const msg of client.iterMessages(storagePeer(), { limit: undefined })) {
    const r = toRecord(msg)
    if (r) fresh.set(r.msgId, r)
  }

  records.clear()
  for (const [id, r] of fresh) records.set(id, r)
  const db = driveDb()
  await db.transaction('rw', db.records, db.kv, async () => {
    await db.records.clear()
    await db.records.bulkPut([...fresh.values()])
    await db.set(KEYS.pts, pts)
  })
  emit()
}

/** Returns false if Telegram says the gap is too big (caller should do a full scan). */
async function syncDifference(startPts: number): Promise<boolean> {
  const client = await getClient()
  let pts = startPts
  for (;;) {
    const diff = await client.invoke(
      new Api.updates.GetChannelDifference({
        channel: storageChannel(),
        filter: new Api.ChannelMessagesFilterEmpty(),
        pts,
        limit: 100,
        force: true,
      }),
    )
    if (diff instanceof Api.updates.ChannelDifferenceTooLong) return false
    if (diff instanceof Api.updates.ChannelDifferenceEmpty) {
      await driveDb().set(KEYS.pts, diff.pts)
      return true
    }

    const changed: Api.TypeMessage[] = [...diff.newMessages]
    const deleted: number[] = []
    for (const u of diff.otherUpdates) {
      if (u instanceof Api.UpdateEditChannelMessage || u instanceof Api.UpdateNewChannelMessage) changed.push(u.message)
      else if (u instanceof Api.UpdateDeleteChannelMessages) deleted.push(...u.messages)
    }
    const upserts: MessageRecord[] = []
    for (const m of changed) {
      const r = toRecord(m)
      if (r) upserts.push(r)
      else deleted.push(m.id)
    }
    await commit(upserts, deleted)
    pts = diff.pts
    await driveDb().set(KEYS.pts, pts)
    if (diff.final) return true
  }
}

/** Resolves once no sync is running (e.g. before switching drives). */
export function syncIdle(): Promise<void> {
  return running.catch(() => {})
}
