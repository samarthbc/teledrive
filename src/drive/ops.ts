import { nanoid } from 'nanoid'
import { Api } from 'telegram'
import { errorCode } from '../telegram/auth'
import { storageChannel, storagePeer } from '../telegram/channel'
import { getClient } from '../telegram/client'
import { messagesFromUpdates } from '../telegram/messages'
import { encode, ROOT, validateName, type FileMeta, type FolderMeta } from './meta'
import { applyDeleted, applyMessages, getRecord } from './sync'
import { randomLong } from './transfer'
import { collectTree, isDescendant, messageIds, uniqueName, type Drive, type Item } from './tree'

const DELETE_BATCH = 100

export async function createFolder(drive: Drive, parentId: string, name: string): Promise<string> {
  const error = validateName(name)
  if (error) throw new Error(error)
  const id = nanoid(10)
  const meta: FolderMeta = {
    td: 1, t: 'd', id, p: parentId, n: uniqueName(drive, parentId, name.trim()), ts: Math.floor(Date.now() / 1000),
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
  const client = await getClient()
  try {
    const res = await client.invoke(
      new Api.messages.EditMessage({ peer: storagePeer(), id: item.msgId, message: encode({ ...current, ...changes }) }),
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
