import { Api } from 'telegram'
import { deleteMessages, refetch, writeMeta } from '../drive/ops'
import { encode, type ConfigMeta, type VaultFolderMeta, type VaultItemMeta } from '../drive/meta'
import { applyMessages, sync } from '../drive/sync'
import { randomLong } from '../drive/transfer'
import { storagePeer } from '../telegram/channel'
import { getClient } from '../telegram/client'
import { messagesFromUpdates } from '../telegram/messages'
import type { Drive } from '../drive/tree'
import type { VaultConfig } from './vaultCrypto'

/** Where TeleWarden's messages go: Telegram (the vault channel), or memory in the dev mock. */
export interface VaultBackend {
  send(meta: VaultItemMeta | VaultFolderMeta): Promise<void>
  edit(msgId: number, meta: VaultItemMeta | VaultFolderMeta): Promise<void>
  remove(msgIds: number[]): Promise<void>
  /** Write the vault part of the pinned config message (null removes it), keeping the rest. */
  writeConfig(drive: Drive, w: VaultConfig | null): Promise<void>
  /** Fetch what changed on Telegram (other devices). */
  sync(): Promise<void>
}

/** The open drive's channel (TeleWarden's, when the vault is in use). */
export const telegramBackend: VaultBackend = {
  async send(meta) {
    const client = await getClient()
    const res = await client.invoke(new Api.messages.SendMessage({ peer: storagePeer(), message: encode(meta), randomId: randomLong(), silent: true }))
    const msgs = messagesFromUpdates(res)
    if (msgs.length) await applyMessages(msgs)
    else if (res instanceof Api.UpdateShortSentMessage) await refetch([res.id])
  },
  edit: (msgId, meta) => writeMeta(msgId, meta),
  remove: (msgIds) => deleteMessages(msgIds),
  async writeConfig(drive, w) {
    if (!drive.configMsgId || !drive.encryption) throw new Error('This drive isn’t ready yet. Try again in a moment.')
    const meta: ConfigMeta = { td: 1, t: 'cfg', app: 'teledrive', e: drive.encryption, ...(w && { w }) }
    await writeMeta(drive.configMsgId, meta)
  },
  sync: () => sync(),
}
