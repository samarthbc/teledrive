import { nanoid } from 'nanoid'
import { Api } from 'telegram'
import { errorCode } from '../telegram/auth'
import { storageChannel, storagePeer } from '../telegram/channel'
import { getClient } from '../telegram/client'
import { messagesFromUpdates } from '../telegram/messages'
import { seal } from './crypto'
import { encode, ROOT, validateName, type FileMeta, type FolderMeta, type Secret } from './meta'
import { rememberSecret, secretOf } from './secrets'
import { encrypting } from './vault'
import { applyDeleted, applyMessages, getRecord } from './sync'
import { db } from '../db/db'
import { randomLong } from './transfer'
import { discard } from './upload'
import {
  collectTree, isDescendant, isHidden, messageIds, trashedItems, uniqueName, type Drive, type Item,
} from './tree'

const DELETE_BATCH = 100

export async function createFolder(drive: Drive, parentId: string, name: string): Promise<string> {
  const error = validateName(name)
  if (error) throw new Error(error)
  const id = nanoid(10)
  const n = uniqueName(drive, parentId, name.trim())
  const ts = Math.floor(Date.now() / 1000)
  let meta: FolderMeta = { td: 1, t: 'd', id, p: parentId, n, ts }
  if (encrypting(drive)) {
    const e = await seal({ n } satisfies Secret)
    rememberSecret(e, { n })
    meta = { td: 1, t: 'd', id, p: parentId, n: '', ts, x: { enc: 1 }, e }
  }
  const client = await getClient()
  const res = await client.invoke(
    new Api.messages.SendMessage({ peer: storagePeer(), message: encode(meta), randomId: randomLong(), silent: true }),
  )
  const msgs = messagesFromUpdates(res)
  if (msgs.length) await applyMessages(msgs)
  else if (res instanceof Api.UpdateShortSentMessage) {
    // Telegram sometimes returns a short ack; fetch the message so it shows up immediately
    await refetch([res.id])
  }
  return id
}

export async function rename(drive: Drive, item: Item, name: string): Promise<void> {
  const error = validateName(name)
  if (error) throw new Error(error)
  if (item.locked) throw new Error('Unlock encrypted files to rename this item')
  const newName = uniqueName(drive, item.parent, name.trim(), item.id)
  if (newName === item.name) return
  await editMeta(item, { n: newName })
}

export async function move(drive: Drive, items: Item[], targetId: string): Promise<void> {
  if (targetId !== ROOT) {
    const target = drive.items.get(targetId)
    if (!target || target.kind !== 'folder') throw new Error('Destination folder not found')
  }
  for (const item of items) {
    if (item.parent === targetId) continue
    if (item.kind === 'folder' && isDescendant(drive, targetId, item.id))
      throw new Error(`Can't move "${item.name}" into itself`)
  }
  for (const item of items) {
    if (item.parent === targetId) continue
    await editMeta(item, { p: targetId, n: uniqueName(drive, targetId, item.name) })
  }
}

const DAY = 24 * 60 * 60
export const TRASH_DAYS = 30
/** Chunks of uploads that were never finished are removed after this long. */
const LEFTOVER_DAYS = 7

const now = () => Math.floor(Date.now() / 1000)

export async function trash(items: Item[]): Promise<void> {
  for (const item of items) await editMeta(item, { x: { ...item.x, tr: now() } })
}

/** Take items out of the trash. If their folder is gone or still in the trash, they go to My Drive. */
export async function restore(drive: Drive, items: Item[]): Promise<void> {
  for (const item of items) {
    const { tr: _, ...x } = item.x
    const parent = drive.items.get(item.parent)
    const p = parent && !isHidden(drive, parent) ? item.parent : ROOT
    await editMeta(item, { x, p, n: uniqueName(drive, p, item.name, item.id) })
  }
}

export async function setStarred(items: Item[], starred: boolean): Promise<void> {
  for (const item of items) {
    if (!!item.x.fav === starred) continue
    const { fav: _, ...rest } = item.x
    await editMeta(item, { x: starred ? { ...rest, fav: 1 } : rest })
  }
}

/** Delete everything in the trash (or only what has been there longer than `olderThanDays`). */
export async function emptyTrash(drive: Drive, olderThanDays = 0): Promise<number> {
  const cutoff = now() - olderThanDays * DAY
  const items = trashedItems(drive).filter((i) => (i.x.tr ?? 0) <= cutoff)
  if (items.length) await remove(drive, items)
  return items.length
}

/** Housekeeping on startup: expire old trash and chunks of abandoned uploads. */
export async function cleanup(drive: Drive): Promise<void> {
  await emptyTrash(drive, TRASH_DAYS)
  const cutoff = now() - LEFTOVER_DAYS * DAY
  for (const state of await db.uploads.toArray()) {
    if (state.updated / 1000 < cutoff) await discard(state)
  }
  const resumable = new Set((await db.uploads.toArray()).map((u) => u.id))
  const leftovers = drive.orphanChunks.filter((msgId) => {
    const r = getRecord(msgId)
    return r && r.date < cutoff && !(r.meta.t === 'c' && resumable.has(r.meta.id))
  })
  if (leftovers.length) await deleteMessages(leftovers)
}

/** Permanently delete items (folders include everything inside them). */
export async function remove(drive: Drive, items: Item[]): Promise<void> {
  const ids = [...new Set(items.flatMap((i) => messageIds(collectTree(drive, i.id))))]
  await deleteMessages(ids)
}

export async function deleteMessages(ids: number[]): Promise<void> {
  const client = await getClient()
  for (let i = 0; i < ids.length; i += DELETE_BATCH) {
    const batch = ids.slice(i, i + DELETE_BATCH)
    await client.invoke(new Api.channels.DeleteMessages({ channel: storageChannel(), id: batch }))
    await applyDeleted(batch)
  }
}

/** Change fields in an item's caption (the folder marker or the file's first part). */
async function editMeta(item: Item, changes: Partial<Pick<FileMeta, 'p' | 'n' | 'x'>>): Promise<void> {
  const current = getRecord(item.msgId)?.meta
  if (!current || (current.t !== 'd' && current.t !== 'f')) throw new Error('Item not found. Try refreshing.')
  let meta = { ...current, ...changes }
  if (current.e) {
    // Encrypted item: the name lives in the encrypted part. Unknown while locked, so it stays as it is.
    const { n, ...rest } = changes
    meta = { ...current, ...rest }
    const secret = secretOf(current.e)
    if (n !== undefined && secret && n !== secret.n) {
      const next: Secret = { ...secret, n }
      meta.e = await seal(next)
      rememberSecret(meta.e, next)
    }
  }
  const client = await getClient()
  try {
    const res = await client.invoke(
      new Api.messages.EditMessage({ peer: storagePeer(), id: item.msgId, message: encode(meta) }),
    )
    await applyMessages(messagesFromUpdates(res))
  } catch (e) {
    if (errorCode(e) !== 'MESSAGE_NOT_MODIFIED') throw e
  }
}

async function refetch(ids: number[]): Promise<void> {
  const client = await getClient()
  const res = await client.invoke(
    new Api.channels.GetMessages({ channel: storageChannel(), id: ids.map((id) => new Api.InputMessageID({ id })) }),
  )
  if ('messages' in res) await applyMessages(res.messages)
}
