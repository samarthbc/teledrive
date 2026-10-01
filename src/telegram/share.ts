import bigInt from 'big-integer'
import { Api } from 'telegram'
import { refreshDoc } from '../drive/download'
import { ROOT_LEVEL } from '../drive/keyring'
import { DriveFileSource } from '../drive/stream'
import { randomLong, withRetry, type TransferControl } from '../drive/transfer'
import { uploadBytes } from '../drive/upload'
import type { FileItem } from '../drive/tree'
import { storagePeer } from './channel'
import { getClient } from './client'

// Sending drive files to a Telegram chat: a decrypted copy is uploaded into the chat.

export interface Chat {
  key: string
  title: string
  subtitle: string
  peer: Api.TypeInputPeer
}

const DIALOG_LIMIT = 200

/** Chats the user can send files to: Saved Messages, people, groups, and channels they can post in. */
export async function listChats(): Promise<Chat[]> {
  const client = await getClient()
  const storageId = storagePeer().channelId.toString()
  const chats: Chat[] = [{ key: 'self', title: 'Saved Messages', subtitle: 'Your own cloud chat', peer: new Api.InputPeerSelf() }]
  for (const d of await client.getDialogs({ limit: DIALOG_LIMIT })) {
    const e = d.entity
    if (!e) continue
    if (e instanceof Api.User) {
      if (e.self || e.deleted || e.bot) continue
      chats.push({ key: `u${e.id}`, title: d.title || d.name || 'Unknown', subtitle: e.username ? `@${e.username}` : 'Contact', peer: d.inputEntity })
    } else if (e instanceof Api.Chat) {
      if (e.left || e.deactivated) continue
      chats.push({ key: `c${e.id}`, title: e.title, subtitle: 'Group', peer: d.inputEntity })
    } else if (e instanceof Api.Channel) {
      if (e.left || e.id.toString() === storageId) continue
      const canPost = e.megagroup ? !e.defaultBannedRights?.sendMedia || e.creator || !!e.adminRights : e.creator || !!e.adminRights?.postMessages
      if (!canPost) continue
      chats.push({ key: `ch${e.id}`, title: e.title, subtitle: e.megagroup ? 'Group' : 'Channel', peer: d.inputEntity })
    }
  }
  return chats
}

/** People found by name or @username who aren't in the recent chats. */
export async function searchPeople(query: string): Promise<Chat[]> {
  const client = await getClient()
  const res = await client.invoke(new Api.contacts.Search({ q: query, limit: 20 }))
  return res.users.flatMap((u) =>
    u instanceof Api.User && !u.self && !u.bot && u.accessHash
      ? [{
          key: `u${u.id}`,
          title: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || 'Unknown',
          subtitle: u.username ? `@${u.username}` : 'Contact',
          peer: new Api.InputPeerUser({ userId: u.id, accessHash: u.accessHash }),
        }]
      : [],
  )
}

/** Telegram's limit for one file sent to a chat. */
const MAX_SEND = 2000 * 1024 * 1024

/** Why a file can't be sent, or null if it can. */
export function cantSend(file: FileItem): string | null {
  if (file.lock || file.level !== ROOT_LEVEL) return "Locked files, and files in locked folders, can't be sent"
  if (!file.complete) return 'This file is incomplete'
  if (file.fileKey && file.size > MAX_SEND) return "Files over 2 GB can't be sent to a chat"
  return null
}

/**
 * Send one file to a chat. Drive files are encrypted, so a decrypted copy is uploaded (with progress
 * through `ctl`); the message goes with it.
 */
export async function sendFile(peer: Api.TypeInputPeer, file: FileItem, message: string, ctl: TransferControl): Promise<void> {
  const why = cantSend(file)
  if (why) throw new Error(why)
  if (!file.fileKey) return sendByReference(peer, file, message)
  const client = await getClient()
  const inputFile = await uploadBytes(new DriveFileSource(file), file.name, ctl)
  await ctl.checkpoint()
  await withRetry(
    () =>
      client.invoke(
        new Api.messages.SendMedia({
          peer,
          media: new Api.InputMediaUploadedDocument({
            file: inputFile,
            mimeType: file.mime,
            attributes: [new Api.DocumentAttributeFilename({ fileName: file.name })],
          }),
          message,
          randomId: randomLong(),
        }),
      ),
    ctl,
  )
}

/** Files from before everything was encrypted: re-send the stored document as it is (big files arrive in parts). */
async function sendByReference(peer: Api.TypeInputPeer, file: FileItem, message: string): Promise<void> {
  const client = await getClient()
  let text = message
  for (const part of file.parts) {
    const send = async (doc = part.doc!) =>
      client.invoke(
        new Api.messages.SendMedia({
          peer,
          media: new Api.InputMediaDocument({
            id: new Api.InputDocument({ id: bigInt(doc.docId), accessHash: bigInt(doc.accessHash), fileReference: Buffer.from(doc.fileRef) }),
          }),
          message: text,
          randomId: randomLong(),
        }),
      )
    try {
      await send()
    } catch (e) {
      // File references expire; get a fresh one and try once more
      if (!(e as { errorMessage?: string }).errorMessage?.startsWith('FILE_REFERENCE_')) throw e
      await send(await refreshDoc(part))
    }
    text = ''
  }
}
