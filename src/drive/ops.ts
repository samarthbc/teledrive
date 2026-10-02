import { nanoid } from 'nanoid'
import { Api } from 'telegram'
import { errorCode } from '../telegram/auth'
import { storageChannel, storagePeer } from '../telegram/channel'
import { getClient } from '../telegram/client'
import { messagesFromUpdates } from '../telegram/messages'
import {
  changeLockPassword, moveLock, newLock, openLock, rewrapFileKey, seal, unseal, type LockInfo,
} from './crypto'
import { closeLevel, openLevel, requireLevelKey } from './keyring'
import { encode, ROOT, validateName, type Flags, type FolderMeta, type Meta, type Secret } from './meta'
import { rememberSecret } from './secrets'
import { applyDeleted, applyMessages, getRecord } from './sync'
import { driveDb } from '../db/db'
import { randomLong } from './transfer'
import { discard } from './upload'
import {
  childLevel, collectTree, isDescendant, isHidden, messageIds, trashedItems, uniqueName, type Drive, type Item,
} from './tree'

const DELETE_BATCH = 100

export async function createFolder(drive: Drive, parentId: string, name: string): Promise<string> {
  const error = validateName(name)
  if (error) throw new Error(error)
  const id = nanoid(10)
  const n = uniqueName(drive, parentId, name.trim())
  const level = childLevel(drive, parentId)
  const e = await seal(requireLevelKey(level), { n } satisfies Secret)
  rememberSecret(e, level, { n })
  const meta: FolderMeta = { td: 1, t: 'd', id, p: parentId, n: '', ts: Math.floor(Date.now() / 1000), x: { enc: 1 }, e }
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
  if (item.locked) throw new Error('Unlock this item to rename it')
  const newName = uniqueName(drive, item.parent, name.trim(), item.id)
  if (newName === item.name) return
  // A locked item's visible name is sealed with its folder's key
  const level = childLevel(drive, item.parent)
  await updateItem(item, { n: newName }, undefined, item.lock ? { key: requireLevelKey(level), level } : undefined)
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
    await moveItem(drive, item, targetId)
  }
}

/**
 * Move one item. Into or out of a locked folder, its keys (and those of everything inside it at the
 * same level) are re-wrapped for the new level. Nothing is re-uploaded.
 */
async function moveItem(drive: Drive, item: Item, targetId: string, x?: Flags): Promise<void> {
  const from = childLevel(drive, item.parent)
  const to = childLevel(drive, targetId)
  const n = item.locked ? undefined : uniqueName(drive, targetId, item.name, item.id)
  if (from === to) return updateItem(item, { p: targetId, n, x })
  const relevel = { from: requireLevelKey(from), to: requireLevelKey(to), toLevel: to }
  await relevelTree(drive, item, { p: targetId, n, x }, relevel)
}

interface Relevel {
  from: CryptoKey
  to: CryptoKey
  /** Level ID the item ends up in. */
  toLevel: string
}

interface Changes {
  p?: string
  n?: string
  x?: Flags
}

/** Re-wrap an item and everything inside it that shares its level (locked items inside keep theirs). */
async function relevelTree(drive: Drive, item: Item, changes: Changes, relevel: Relevel): Promise<void> {
  await updateItem(item, changes, relevel)
  if (item.kind !== 'folder' || item.lock) return
  for (const child of drive.allChildren.get(item.id) ?? []) await relevelTree(drive, child, {}, relevel)
}

/**
 * Rewrite an item's caption: new parent, name or flags, and, with `relevel`, new level keys. Renaming a locked
 * item needs `label`: its folder's key, for the name shown while it's locked.
 */
async function updateItem(item: Item, changes: Changes, relevel?: Relevel, label?: { key: CryptoKey; level: string }): Promise<void> {
  const current = currentMeta(item)
  const meta = { ...current }
  if (changes.p !== undefined) meta.p = changes.p
  if (changes.x) meta.x = { ...changes.x, ...(current.x?.enc && { enc: 1 as const }) }
  const renamed = changes.n !== undefined && changes.n !== item.name

  if (!current.e) {
    // From before everything was encrypted
    if (renamed) meta.n = changes.n!
  } else if (current.l) {
    // A locked item: its name is sealed with its own lock key; moving only re-wraps the lock
    if (renamed) {
      const own = requireLevelKey(item.level)
      meta.e = await reseal(current.e, own, own, item.level, changes.n)
      if (label) meta.ln = await sealLabel(changes.n!, label.key, label.level)
    }
    if (relevel) {
      meta.l = await moveLock(current.l, relevel.from, relevel.to)
      // Its visible name goes with it to the new folder's key
      if (meta.ln) meta.ln = await reseal(meta.ln, relevel.from, relevel.to, relevel.toLevel)
    }
  } else {
    const own = relevel?.from ?? requireLevelKey(item.level)
    const target = relevel?.to ?? own
    if (renamed || relevel) meta.e = await reseal(current.e, own, target, relevel?.toLevel ?? item.level, changes.n)
    if (relevel && meta.t === 'f' && meta.k) meta.k = await rewrapFileKey(meta.k, relevel.from, relevel.to)
  }
  await writeMeta(item.msgId, meta)
}

/** A locked item's visible name (`ln`), sealed with its folder's key. */
async function sealLabel(name: string, folderKey: CryptoKey, folderLevel: string): Promise<string> {
  const secret: Secret = { n: name }
  const out = await seal(folderKey, secret)
  rememberSecret(out, folderLevel, secret)
  return out
}

/** Decrypt sealed caption fields with one key and seal them (optionally renamed) with another. */
async function reseal(sealed: string, from: CryptoKey, to: CryptoKey, toLevel: string, name?: string): Promise<string> {
  const secret = await unseal<Secret>(from, sealed)
  if (name !== undefined) secret.n = name
  const out = await seal(to, secret)
  rememberSecret(out, toLevel, secret)
  return out
}

function currentMeta(item: Item): Extract<Meta, { t: 'd' | 'f' }> {
  const current = getRecord(item.msgId)?.meta
  if (!current || (current.t !== 'd' && current.t !== 'f')) throw new Error('Item not found. Try refreshing.')
  return current
}

async function writeMeta(msgId: number, meta: Meta): Promise<void> {
  const client = await getClient()
  try {
    const res = await client.invoke(new Api.messages.EditMessage({ peer: storagePeer(), id: msgId, message: encode(meta) }))
    await applyMessages(messagesFromUpdates(res))
  } catch (e) {
    if (errorCode(e) !== 'MESSAGE_NOT_MODIFIED') throw e
  }
}

// ---- Locked files and folders ----
// The caller checks the TeleDrive password first (locking, removing a lock, changing a password).

/**
 * Lock an item with its own password. It (and what's inside a folder) is re-wrapped; nothing is re-uploaded.
 * With `keepOpen` it stays unlocked for this session (e.g. to re-encrypt it next).
 */
export async function lockItem(drive: Drive, item: Item, password: string, keepOpen = false): Promise<void> {
  if (item.lock) throw new Error('This item is already locked')
  if (item.locked) throw new Error('Unlock it first')
  const parentLevel = childLevel(drive, item.parent)
  const parentKey = requireLevelKey(parentLevel)
  const { lock, key } = await newLock(parentKey, password)
  const relevel: Relevel = { from: parentKey, to: key, toLevel: item.id }

  // The item itself: sealed with its new lock key, with the lock written next to it, and its name readable
  // with the folder's key so it still shows while locked
  const current = currentMeta(item)
  const meta = { ...current, l: lock, ln: await sealLabel(item.name, parentKey, parentLevel), x: { ...current.x, enc: 1 as const } }
  if (current.e) meta.e = await reseal(current.e, parentKey, key, item.id)
  if (meta.t === 'f' && meta.k) meta.k = await rewrapFileKey(meta.k, parentKey, key)
  // Its contents need the new key while they're re-wrapped
  openLevel(item.id, key)
  try {
    await writeMeta(item.msgId, meta)
    if (item.kind === 'folder') for (const child of drive.allChildren.get(item.id) ?? []) await relevelTree(drive, child, {}, relevel)
  } finally {
    if (!keepOpen) closeLevel(item.id)
  }
}

/** Open a locked item for this session (WrongPasswordError if the password is wrong). */
export async function unlockItem(drive: Drive, item: Item, password: string): Promise<void> {
  if (!item.lock) return
  const parentLevel = childLevel(drive, item.parent)
  const parentKey = requireLevelKey(parentLevel)
  const key = await openLock(item.lock, parentKey, password)
  openLevel(item.id, key)
  await addLabel(item, key, parentKey, parentLevel).catch((e) => console.warn('Could not save the name of a locked item', e))
}

/** Items locked before names showed while locked: add the visible name the first time they're unlocked. */
async function addLabel(item: Item, ownKey: CryptoKey, parentKey: CryptoKey, parentLevel: string): Promise<void> {
  const current = currentMeta(item)
  if (current.ln || !current.e) return
  const { n } = await unseal<Secret>(ownKey, current.e)
  await writeMeta(item.msgId, { ...current, ln: await sealLabel(n, parentKey, parentLevel) })
}

/** Lock an unlocked item again (until its password is entered). */
export function relockItem(item: Item): void {
  closeLevel(item.id)
}

/** Remove an item's lock for good (it must be unlocked). Its keys are re-wrapped for its folder's level. */
export async function removeLock(drive: Drive, item: Item): Promise<void> {
  if (!item.lock) return
  const parentLevel = childLevel(drive, item.parent)
  const parentKey = requireLevelKey(parentLevel)
  const key = requireLevelKey(item.id)
  const relevel: Relevel = { from: key, to: parentKey, toLevel: parentLevel }
  // Contents first: if this stops halfway, the item is still locked and its contents still readable with it
  if (item.kind === 'folder') for (const child of drive.allChildren.get(item.id) ?? []) await relevelTree(drive, child, {}, relevel)
  const { l: _, ln: _label, ...current } = currentMeta(item)
  const meta = { ...current }
  if (current.e) meta.e = await reseal(current.e, key, parentKey, parentLevel)
  if (meta.t === 'f' && meta.k) meta.k = await rewrapFileKey(meta.k, key, parentKey)
  await writeMeta(item.msgId, meta)
  closeLevel(item.id)
}

/** New password for a locked item (needs its current password; nothing inside changes). */
export async function changeItemPassword(drive: Drive, item: Item, oldPassword: string, newPassword: string): Promise<void> {
  if (!item.lock) throw new Error('This item is not locked')
  const parentKey = requireLevelKey(childLevel(drive, item.parent))
  const lock: LockInfo = await changeLockPassword(item.lock, parentKey, oldPassword, newPassword)
  await writeMeta(item.msgId, { ...currentMeta(item), l: lock })
}

/** Files to upload again with fresh keys ("Re-encrypt"): the file, or every file inside a folder up to nested locks. */
export function filesToReencrypt(drive: Drive, item: Item): Item[] {
  if (item.kind === 'file') return [item]
  const out: Item[] = []
  const walk = (id: string) => {
    for (const child of drive.allChildren.get(id) ?? []) {
      if (child.lock) continue
      if (child.kind === 'file') out.push(child)
      else walk(child.id)
    }
  }
  walk(item.id)
  return out
}

const DAY = 24 * 60 * 60
export const TRASH_DAYS = 30
/** Chunks of uploads that were never finished are removed after this long. */
const LEFTOVER_DAYS = 7

const now = () => Math.floor(Date.now() / 1000)

export async function trash(items: Item[]): Promise<void> {
  for (const item of items) await updateItem(item, { x: { ...item.x, tr: now() } })
}

/** Take items out of the trash. If their folder is gone or still in the trash, they go to My Drive. */
export async function restore(drive: Drive, items: Item[]): Promise<void> {
  for (const item of items) {
    const { tr: _, ...x } = item.x
    const parent = drive.items.get(item.parent)
    const p = parent && !isHidden(drive, parent) ? item.parent : ROOT
    if (p === item.parent) await updateItem(item, { x, n: item.locked ? undefined : uniqueName(drive, p, item.name, item.id) })
    else await moveItem(drive, item, p, x)
  }
}

export async function setStarred(items: Item[], starred: boolean): Promise<void> {
  for (const item of items) {
    if (!!item.x.fav === starred) continue
    const { fav: _, ...rest } = item.x
    await updateItem(item, { x: starred ? { ...rest, fav: 1 } : rest })
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
  for (const state of await driveDb().uploads.toArray()) {
    if (state.updated / 1000 < cutoff) await discard(state)
  }
  const resumable = new Set((await driveDb().uploads.toArray()).map((u) => u.id))
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

async function refetch(ids: number[]): Promise<void> {
  const client = await getClient()
  const res = await client.invoke(
    new Api.channels.GetMessages({ channel: storageChannel(), id: ids.map((id) => new Api.InputMessageID({ id })) }),
  )
  if ('messages' in res) await applyMessages(res.messages)
}
