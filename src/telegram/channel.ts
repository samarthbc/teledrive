import bigInt from 'big-integer'
import { Api } from 'telegram'
import { getKV, KEYS, setKV } from '../db/db'
import { encode, type ConfigMeta } from '../drive/meta'
import { getClient } from './client'

// Each drive is a private channel. The first one is "TeleDrive Storage"; TelePhotos is "TeleDrive Photos";
// more are "TeleDrive · <name>".

const MAIN_TITLE = 'TeleDrive Storage'
const PHOTOS_TITLE = 'TeleDrive Photos'
export const PHOTOS_NAME = 'TelePhotos'
const TITLE_PREFIX = 'TeleDrive · '
const ABOUT_MARKER = 'teledrive:v1'
const ABOUT = `${ABOUT_MARKER} · Storage for TeleDrive. Don't post or delete messages here manually.`
const MAX_DRIVE_NAME = 64

export interface DriveInfo {
  id: string
  accessHash: string
  title: string
}

let peer: Api.InputPeerChannel | null = null
let current: DriveInfo | null = null

export function storagePeer(): Api.InputPeerChannel {
  if (!peer) throw new Error('Storage channel not ready')
  return peer
}

export function storageChannel(): Api.InputChannel {
  const p = storagePeer()
  return new Api.InputChannel({ channelId: p.channelId, accessHash: p.accessHash })
}

/** Use this drive's channel for everything from now on. */
export function openStorage(d: DriveInfo): void {
  peer = new Api.InputPeerChannel({ channelId: bigInt(d.id), accessHash: bigInt(d.accessHash) })
  current = d
}

export function currentDriveId(): string | null {
  return current?.id ?? null
}

/** The open drive. */
export function currentDrive(): DriveInfo | null {
  return current
}

/** TelePhotos: the drive for photos and videos (camera backup goes there). */
export function isPhotosDrive(d: DriveInfo | null | undefined): boolean {
  return d?.title === PHOTOS_TITLE
}

/**
 * The name shown in the app: "My Drive" for the first drive, "TelePhotos" for the photos drive, otherwise the part
 * after "TeleDrive · ".
 */
export function driveName(d: DriveInfo): string {
  if (d.title === MAIN_TITLE) return 'My Drive'
  if (d.title === PHOTOS_TITLE) return PHOTOS_NAME
  return d.title.startsWith(TITLE_PREFIX) ? d.title.slice(TITLE_PREFIX.length) : d.title
}

/** The saved drive list; on first run, finds existing drives (or creates the first one). */
export async function loadDrives(): Promise<DriveInfo[]> {
  const saved = await getKV<DriveInfo[]>(KEYS.drives)
  if (saved?.length) return saved
  let drives = await discoverDrives()
  if (!drives.length) drives = [await createChannel(MAIN_TITLE)]
  await setKV(KEYS.drives, drives)
  return drives
}

/** Look for drives again (e.g. one created on another device) and save the updated list. */
export async function refreshDrives(known: DriveInfo[]): Promise<DriveInfo[]> {
  const found = await discoverDrives()
  if (!found.length) return known
  const byId = new Map(found.map((d) => [d.id, d]))
  // Keep the known order; drop drives that are gone; add new ones at the end
  const drives = sortDrives([...known.flatMap((d) => byId.get(d.id) ?? []), ...found.filter((d) => !known.some((k) => k.id === d.id))])
  await setKV(KEYS.drives, drives)
  return drives
}

export async function createDrive(name: string, known: DriveInfo[]): Promise<{ drive: DriveInfo; drives: DriveInfo[] }> {
  const n = name.trim()
  if (!n) throw new Error('Give the drive a name')
  if (n.length > MAX_DRIVE_NAME) throw new Error(`Drive names can be at most ${MAX_DRIVE_NAME} characters`)
  if (n.toLowerCase() === PHOTOS_NAME.toLowerCase()) throw new Error(`${PHOTOS_NAME} is the built-in drive for photos`)
  if (known.some((d) => driveName(d).toLowerCase() === n.toLowerCase())) throw new Error('A drive with this name already exists')
  const drive = await createChannel(TITLE_PREFIX + n)
  const drives = [...known, drive]
  await setKV(KEYS.drives, drives)
  return { drive, drives }
}

/** Create TelePhotos (once) and put it right after My Drive in the list. */
export async function createPhotosDrive(known: DriveInfo[]): Promise<{ drive: DriveInfo; drives: DriveInfo[] }> {
  const existing = known.find(isPhotosDrive)
  if (existing) return { drive: existing, drives: known }
  const drive = await createChannel(PHOTOS_TITLE)
  const drives = sortDrives([...known, drive])
  await setKV(KEYS.drives, drives)
  return { drive, drives }
}

/** My Drive first, then TelePhotos, then the rest in their order. */
function sortDrives(drives: DriveInfo[]): DriveInfo[] {
  const rank = (d: DriveInfo) => (d.title === MAIN_TITLE ? 0 : isPhotosDrive(d) ? 1 : 2)
  return [...drives].sort((a, b) => rank(a) - rank(b))
}

export async function stillAccessible(c: DriveInfo): Promise<boolean> {
  const client = await getClient()
  try {
    const res = await client.invoke(
      new Api.channels.GetChannels({
        id: [new Api.InputChannel({ channelId: bigInt(c.id), accessHash: bigInt(c.accessHash) })],
      }),
    )
    const chat = res.chats[0]
    return chat instanceof Api.Channel && !chat.left
  } catch {
    return false
  }
}

/** All channels you created whose description has the TeleDrive marker (My Drive first, then TelePhotos). */
async function discoverDrives(): Promise<DriveInfo[]> {
  const client = await getClient()
  const dialogs = await client.getDialogs({ limit: 500 })
  const out: DriveInfo[] = []
  for (const d of dialogs) {
    const e = d.entity
    if (!(e instanceof Api.Channel) || !e.creator || !e.accessHash || !e.title.startsWith('TeleDrive')) continue
    const full = await client.invoke(
      new Api.channels.GetFullChannel({ channel: new Api.InputChannel({ channelId: e.id, accessHash: e.accessHash }) }),
    )
    if (full.fullChat.about.includes(ABOUT_MARKER)) out.push({ id: e.id.toString(), accessHash: e.accessHash.toString(), title: e.title })
  }
  return sortDrives(out)
}

async function createChannel(title: string): Promise<DriveInfo> {
  const client = await getClient()
  const res = await client.invoke(new Api.channels.CreateChannel({ title, about: ABOUT, broadcast: true }))
  const chat = 'chats' in res ? res.chats.find((c) => c instanceof Api.Channel) : undefined
  if (!(chat instanceof Api.Channel) || !chat.accessHash) throw new Error('Could not create the storage channel')
  const saved = { id: chat.id.toString(), accessHash: chat.accessHash.toString(), title }

  const inputPeer = new Api.InputPeerChannel({ channelId: chat.id, accessHash: chat.accessHash })
  const cfg: ConfigMeta = { td: 1, t: 'cfg', app: 'teledrive' }
  const msg = await client.sendMessage(inputPeer, { message: encode(cfg) })
  await client.invoke(new Api.messages.UpdatePinnedMessage({ peer: inputPeer, id: msg.id, silent: true }))
  return saved
}
