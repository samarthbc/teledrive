import bigInt from 'big-integer'
import { Api } from 'telegram'
import { refreshDoc } from '../drive/download'
import { randomLong } from '../drive/transfer'
import type { FileItem } from '../drive/tree'
import { storagePeer } from './channel'
import { getClient } from './client'

// Sending drive files to a Telegram chat. Files are re-sent by reference (no re-upload), so even big
// files go out instantly.

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

/** Why a file can't be sent, or null if it can. */
export function cantSend(file: FileItem): string | null {
  if (file.salt) return "Encrypted files can't be sent (the other person couldn't open them)"
  if (!file.complete) return 'This file is incomplete'
  return null
}

/** Send files to a chat (big files arrive as several parts). The message goes with the first file. */
export async function sendFiles(peer: Api.TypeInputPeer, files: FileItem[], message = ''): Promise<void> {
  const client = await getClient()
  let text = message
  for (const file of files) {
    const why = cantSend(file)
    if (why) throw new Error(`“${file.name}”: ${why}`)
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
}
