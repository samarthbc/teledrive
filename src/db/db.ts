import Dexie, { type Table } from 'dexie'
import type { MessageRecord } from '../drive/tree'

/** Progress of an upload, so it can continue after a failure or page reload. */
export interface UploadState {
  /** Fingerprint: parent folder + file name + size + last modified. */
  key: string
  id: string
  name: string
  chunks: Record<number, ChunkState>
  updated: number
}

export interface ChunkState {
  /** Set once the chunk's message has been sent. */
  msgId?: number
  /** Telegram upload file ID (parts stay on Telegram's servers for a while). */
  tgFileId?: string
  /** Upload parts already sent for this chunk. */
  done?: number[]
}

interface Thumb {
  id: string
  blob: Blob
}

interface KV {
  key: string
  value: unknown
}

class TeleDriveDB extends Dexie {
  kv!: Table<KV, string>
  records!: Table<MessageRecord, number>
  thumbs!: Table<Thumb, string>
  uploads!: Table<UploadState, string>

  constructor() {
    super('teledrive')
    this.version(1).stores({
      kv: 'key',
      records: 'msgId',
    })
    this.version(2).stores({
      thumbs: 'id',
      uploads: 'key',
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
  await db.transaction('rw', [db.kv, db.records, db.thumbs, db.uploads], async () => {
    await db.records.clear()
    await db.thumbs.clear()
    await db.uploads.clear()
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
