import { Api } from 'telegram'
import { delKV, getKV, setKV } from '../db/db'
import { storagePeer, type DriveInfo } from '../telegram/channel'
import { getClient } from '../telegram/client'
import { messagesFromUpdates } from '../telegram/messages'
import bigInt from 'big-integer'
import { checkAccountPassword, createAccount, unlockAccount, type AccountConfig, type AccountKeys } from './crypto'
import { accountConfig, setAccount } from './keyring'
import { decode, encode, type ConfigMeta } from './meta'
import { applyMessages } from './sync'
import { randomLong } from './transfer'
import type { Drive } from './tree'

// The TeleDrive password: finding its check value, entering or creating it, remembering it on the device.

/** Account keys remembered on this device (non-extractable CryptoKeys) plus the check value they belong to. */
const DEVICE_KEY = 'accountKeys'
const CONFIG_KEY = 'accountConfig'

interface Remembered {
  config: AccountConfig
  keys: AccountKeys
}

/** Use the keys remembered on this device, if they match the account's check value. */
export async function restoreDeviceKeys(config: AccountConfig | null): Promise<boolean> {
  const saved = await getKV<Remembered>(DEVICE_KEY)
  if (!saved || (config && saved.config.id !== config.id)) return false
  setAccount(saved.keys, saved.config)
  return true
}

/**
 * The TeleDrive password's check value: from the open drive, else this device, else any other drive.
 * Null means it was never set (a new account).
 */
export async function findAccountConfig(drive: Drive, drives: DriveInfo[], current: string | null): Promise<AccountConfig | null> {
  if (drive.encryption) return drive.encryption
  const saved = await getKV<AccountConfig>(CONFIG_KEY)
  if (saved) return saved
  for (const d of drives) {
    if (d.id === current) continue
    const config = await configOfDrive(d).catch(() => null)
    if (config) return config
  }
  return null
}

/** Read another drive's pinned config message. */
async function configOfDrive(d: DriveInfo): Promise<AccountConfig | null> {
  const client = await getClient()
  const channel = new Api.InputChannel({ channelId: bigInt(d.id), accessHash: bigInt(d.accessHash) })
  const full = await client.invoke(new Api.channels.GetFullChannel({ channel }))
  const pinned = (full.fullChat as Api.ChannelFull).pinnedMsgId
  if (!pinned) return null
  const res = await client.invoke(new Api.channels.GetMessages({ channel, id: [new Api.InputMessageID({ id: pinned })] }))
  const msg = 'messages' in res ? res.messages[0] : undefined
  const meta = msg instanceof Api.Message ? decode(msg.message) : null
  return meta?.t === 'cfg' ? (meta.e ?? null) : null
}

/** First time: create the TeleDrive password. */
export async function createPassword(password: string): Promise<void> {
  const { config, keys } = await createAccount(password)
  await remember(config, keys)
}

/** New device: enter the TeleDrive password. Throws WrongPasswordError. */
export async function enterPassword(config: AccountConfig, password: string): Promise<void> {
  await remember(config, await unlockAccount(config, password))
}

async function remember(config: AccountConfig, keys: AccountKeys) {
  setAccount(keys, config)
  await setKV(DEVICE_KEY, { config, keys } satisfies Remembered)
  await setKV(CONFIG_KEY, config)
}

/** Forget the keys in memory (logging out also deletes the remembered ones). */
export async function forgetAccount(): Promise<void> {
  setAccount(null)
  await delKV(DEVICE_KEY).catch(() => {})
}

/** Confirm it's really the owner (before locking, removing a lock, changing an item's password). */
export async function verifyPassword(password: string): Promise<boolean> {
  const config = accountConfig()
  if (!config) throw new Error('Enter your TeleDrive password first')
  return checkAccountPassword(config, password)
}

/** Make sure the drive's config message carries the check value (new drives, or drives from before). */
export async function ensureDriveConfig(drive: Drive): Promise<void> {
  const config = accountConfig()
  // Never overwrite a check value that's already there (its files depend on it)
  if (!config || drive.encryption) return
  const client = await getClient()
  const message = encode({ td: 1, t: 'cfg', app: 'teledrive', e: config } satisfies ConfigMeta)
  if (drive.configMsgId) {
    const res = await client.invoke(new Api.messages.EditMessage({ peer: storagePeer(), id: drive.configMsgId, message }))
    await applyMessages(messagesFromUpdates(res))
    return
  }
  const res = await client.invoke(new Api.messages.SendMessage({ peer: storagePeer(), message, randomId: randomLong(), silent: true }))
  const msgs = messagesFromUpdates(res)
  await applyMessages(msgs)
  if (msgs[0]) await client.invoke(new Api.messages.UpdatePinnedMessage({ peer: storagePeer(), id: msgs[0].id, silent: true }))
}
