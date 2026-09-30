import Dexie, { type Table } from 'dexie'
import type { MessageRecord } from '../drive/tree'

interface KV {
  key: string
  value: unknown
}

class TeleDriveDB extends Dexie {
  kv!: Table<KV, string>
  records!: Table<MessageRecord, number>

  constructor() {
    super('teledrive')
    this.version(1).stores({
      kv: 'key',
      records: 'msgId',
    })
  }
}

export const db = new TeleDriveDB()

export async function getKV<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined
}

export async function setKV(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value })
}

export async function delKV(key: string): Promise<void> {
  await db.kv.delete(key)
}

/** Everything tied to the logged-in account (keeps API keys entered on the Setup page). */
export async function clearAccountData(): Promise<void> {
  await db.transaction('rw', db.kv, db.records, async () => {
    await db.records.clear()
    await db.kv.where('key').noneOf(['apiId', 'apiHash']).delete()
  })
}

export const KEYS = {
  session: 'session',
  apiId: 'apiId',
  apiHash: 'apiHash',
  channel: 'channel',
  pts: 'pts',
  view: 'view',
  sort: 'sort',
} as const
