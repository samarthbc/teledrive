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
  /** Salt of the file's encryption key, if the upload is encrypted. */
  salt?: string
  /** SHA-256 of the content (hex). */
  hash?: string
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

/** Account-level data: API keys, session, list of drives, settings. (Its other tables are from before multiple drives.) */
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

const DRIVE_DB_PREFIX = 'teledrive-drive-'

/** One drive's data: its file index, thumbnails, unfinished uploads, sync position, remembered key. */
export class DriveDB extends Dexie {
  kv!: Table<KV, string>
  records!: Table<MessageRecord, number>
  thumbs!: Table<Thumb, string>
  uploads!: Table<UploadState, string>

  constructor(driveId: string) {
    super(DRIVE_DB_PREFIX + driveId)
    this.version(1).stores({ kv: 'key', records: 'msgId', thumbs: 'id', uploads: 'key' })
  }

  async get<T>(key: string): Promise<T | undefined> {
    return (await this.kv.get(key))?.value as T | undefined
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.kv.put({ key, value })
  }

  async del(key: string): Promise<void> {
    await this.kv.delete(key)
  }
}

export const db = new TeleDriveDB()

let current: DriveDB | null = null

/** The open drive's database. */
export function driveDb(): DriveDB {
  if (!current) throw new Error('No drive is open')
  return current
}

/** Switch to a drive's database. Data from before multiple drives existed is moved into it. */
export async function openDriveDb(driveId: string): Promise<DriveDB> {
  if (current?.name === DRIVE_DB_PREFIX + driveId) return current
  current?.close()
  current = new DriveDB(driveId)
  await migrateLegacy(driveId, current)
  return current
}

async function migrateLegacy(driveId: string, target: DriveDB) {
  const legacy = await getKV<{ id: string }>(KEYS.channel)
  if (legacy?.id !== driveId) return
  const [records, thumbs, uploads, pts] = await Promise.all([
    db.records.toArray(), db.thumbs.toArray(), db.uploads.toArray(), getKV<number>(KEYS.pts),
  ])
  await target.transaction('rw', [target.kv, target.records, target.thumbs, target.uploads], async () => {
    await target.records.bulkPut(records)
    await target.thumbs.bulkPut(thumbs)
    await target.uploads.bulkPut(uploads)
    if (pts !== undefined) await target.set(KEYS.pts, pts)
    const key = await getKV(LEGACY_VAULT_KEY)
    if (key) await target.set(LEGACY_VAULT_KEY, key)
  })
  await db.transaction('rw', [db.kv, db.records, db.thumbs, db.uploads], async () => {
    await db.records.clear()
    await db.thumbs.clear()
    await db.uploads.clear()
    await db.kv.bulkDelete([KEYS.channel, KEYS.pts, LEGACY_VAULT_KEY])
  })
}
const LEGACY_VAULT_KEY = 'vault'

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
  current?.close()
  current = null
  const names = await Dexie.getDatabaseNames().catch(() => [] as string[])
  for (const name of names) if (name.startsWith(DRIVE_DB_PREFIX)) await Dexie.delete(name)
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
  /** Before multiple drives: the one storage channel. */
  channel: 'channel',
  /** Sync position (in the drive's database). */
  pts: 'pts',
  drives: 'drives',
  currentDrive: 'currentDrive',
  view: 'view',
  sort: 'sort',
} as const
