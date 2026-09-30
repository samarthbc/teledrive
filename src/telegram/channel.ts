import bigInt from 'big-integer'
import { Api } from 'telegram'
import { getKV, KEYS, setKV } from '../db/db'
import { encode, type ConfigMeta } from '../drive/meta'
import { getClient } from './client'

const TITLE = 'TeleDrive Storage'
const ABOUT_MARKER = 'teledrive:v1'
const ABOUT = `${ABOUT_MARKER} · Storage for TeleDrive. Don't post or delete messages here manually.`

interface SavedChannel {
  id: string
  accessHash: string
}

let peer: Api.InputPeerChannel | null = null

export function storagePeer(): Api.InputPeerChannel {
  if (!peer) throw new Error('Storage channel not ready')
  return peer
}

export function storageChannel(): Api.InputChannel {
  const p = storagePeer()
  return new Api.InputChannel({ channelId: p.channelId, accessHash: p.accessHash })
}

function setPeer(c: SavedChannel) {
  peer = new Api.InputPeerChannel({ channelId: bigInt(c.id), accessHash: bigInt(c.accessHash) })
}

/** Find the storage channel (saved → search dialogs → create). Returns true if it was newly created. */
export async function ensureStorageChannel(): Promise<boolean> {
  const saved = await getKV<SavedChannel>(KEYS.channel)
  if (saved && (await stillAccessible(saved))) {
    setPeer(saved)
    return false
  }

  const found = await findExisting()
  if (found) {
    await setKV(KEYS.channel, found)
    setPeer(found)
    return false
  }

  const created = await createChannel()
  await setKV(KEYS.channel, created)
  setPeer(created)
  return true
}

async function stillAccessible(c: SavedChannel): Promise<boolean> {
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

async function findExisting(): Promise<SavedChannel | null> {
  const client = await getClient()
  const dialogs = await client.getDialogs({ limit: 500 })
  for (const d of dialogs) {
    const e = d.entity
    if (!(e instanceof Api.Channel) || !e.creator || !e.accessHash || !e.title.startsWith('TeleDrive')) continue
    const full = await client.invoke(
      new Api.channels.GetFullChannel({ channel: new Api.InputChannel({ channelId: e.id, accessHash: e.accessHash }) }),
    )
    if (full.fullChat.about.includes(ABOUT_MARKER)) return { id: e.id.toString(), accessHash: e.accessHash.toString() }
  }
  return null
}

async function createChannel(): Promise<SavedChannel> {
  const client = await getClient()
  const res = await client.invoke(new Api.channels.CreateChannel({ title: TITLE, about: ABOUT, broadcast: true }))
  const chat = 'chats' in res ? res.chats.find((c) => c instanceof Api.Channel) : undefined
  if (!(chat instanceof Api.Channel) || !chat.accessHash) throw new Error('Could not create the storage channel')
  const saved = { id: chat.id.toString(), accessHash: chat.accessHash.toString() }

  const inputPeer = new Api.InputPeerChannel({ channelId: chat.id, accessHash: chat.accessHash })
  const cfg: ConfigMeta = { td: 1, t: 'cfg', app: 'teledrive' }
  const msg = await client.sendMessage(inputPeer, { message: encode(cfg) })
  await client.invoke(new Api.messages.UpdatePinnedMessage({ peer: inputPeer, id: msg.id, silent: true }))
  return saved
}
