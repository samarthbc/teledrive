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

/**
 * Chats the user can send files to: Saved Messages, people, groups, and channels they can post in. Not the drives'
 * own channels (`driveIds`, and the open one).
 */
export async function listChats(driveIds: string[] = []): Promise<Chat[]> {
  const client = await getClient()
  const drives = new Set([storagePeer().channelId.toString(), ...driveIds])
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
      if (e.left || drives.has(e.id.toString())) continue
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

// ---- Sharing a TelePhotos album ----

/** Telegram puts at most 10 photos/videos in one album message. */
const GROUP = 10
/** Telegram's limit for a file sent as a photo (bigger ones go as files). */
const MAX_PHOTO = 10 * 1024 * 1024
const PHOTO_TYPES = /^image\/(jpeg|png|webp)$/

type SendKind = 'photo' | 'video' | 'file'

/** As photos: Telegram shows them in a grid (and makes the photos smaller). Otherwise the original files. */
function sendKind(file: FileItem, asPhotos: boolean): SendKind {
  if (!asPhotos) return 'file'
  if (PHOTO_TYPES.test(file.mime) && file.size <= MAX_PHOTO) return 'photo'
  if (file.mime.startsWith('video/')) return 'video'
  return 'file'
}

function chunks<T>(list: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n))
  return out
}

/**
 * Send photos to a chat as Telegram albums (groups of up to 10), the caption on the first. Photos and videos can share
 * a group, files only group with files. Progress for all of them goes through `ctl`.
 */
export async function sendAlbum(
  peer: Api.TypeInputPeer, files: FileItem[], caption: string, asPhotos: boolean, ctl: TransferControl,
): Promise<void> {
  const client = await getClient()
  const encrypted = files.filter((f) => f.fileKey)
  const media = encrypted.filter((f) => sendKind(f, asPhotos) !== 'file')
  const docs = encrypted.filter((f) => sendKind(f, asPhotos) === 'file')
  let text = caption
  for (const group of [...chunks(media, GROUP), ...chunks(docs, GROUP)]) {
    const items: Api.InputSingleMedia[] = []
    for (const f of group) {
      items.push(new Api.InputSingleMedia({ media: await uploadMedia(peer, f, sendKind(f, asPhotos), ctl), message: text, randomId: randomLong() }))
      text = ''
    }
    await ctl.checkpoint()
    await withRetry(
      () =>
        client.invoke(
          items.length === 1
            ? new Api.messages.SendMedia({ peer, media: items[0].media, message: items[0].message, randomId: randomLong() })
            : new Api.messages.SendMultiMedia({ peer, multiMedia: items }),
        ),
      ctl,
    )
  }
  // From before everything was encrypted: one by one
  for (const f of files.filter((x) => !x.fileKey)) {
    await sendByReference(peer, f, text)
    ctl.progress(f.size)
    text = ''
  }
}

/** Upload a decrypted copy to Telegram (not sent yet) and return it ready to go into an album message. */
async function uploadMedia(peer: Api.TypeInputPeer, file: FileItem, kind: SendKind, ctl: TransferControl): Promise<Api.TypeInputMedia> {
  const client = await getClient()
  const inputFile = await uploadBytes(new DriveFileSource(file), file.name, ctl)
  await ctl.checkpoint()
  const filename = new Api.DocumentAttributeFilename({ fileName: file.name })
  const uploaded =
    kind === 'photo'
      ? new Api.InputMediaUploadedPhoto({ file: inputFile })
      : new Api.InputMediaUploadedDocument({
          file: inputFile,
          mimeType: file.mime,
          forceFile: kind === 'file',
          attributes:
            kind === 'video'
              ? [new Api.DocumentAttributeVideo({ duration: 0, w: file.wh?.[0] ?? 0, h: file.wh?.[1] ?? 0, supportsStreaming: true }), filename]
              : [filename],
        })
  const res = await withRetry(() => client.invoke(new Api.messages.UploadMedia({ peer, media: uploaded })), ctl)
  if (res instanceof Api.MessageMediaPhoto && res.photo instanceof Api.Photo) {
    const p = res.photo
    return new Api.InputMediaPhoto({ id: new Api.InputPhoto({ id: p.id, accessHash: p.accessHash, fileReference: p.fileReference }) })
  }
  if (res instanceof Api.MessageMediaDocument && res.document instanceof Api.Document) {
    const d = res.document
    return new Api.InputMediaDocument({ id: new Api.InputDocument({ id: d.id, accessHash: d.accessHash, fileReference: d.fileReference }) })
  }
  throw new Error(`Telegram didn't accept “${file.name}”`)
}
