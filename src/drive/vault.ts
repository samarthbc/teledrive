import { Api } from 'telegram'
import { delKV, getKV, setKV } from '../db/db'
import { storagePeer } from '../telegram/channel'
import { getClient } from '../telegram/client'
import { messagesFromUpdates } from '../telegram/messages'
import {
  changePassword, createEncryption, isUnlocked, setKeys, unlockKeys, type EncryptionConfig, type Keys,
} from './crypto'
import { encode, type ConfigMeta } from './meta'
import { clearSecrets } from './secrets'
import { applyMessages } from './sync'
import { randomLong } from './transfer'
import type { Drive } from './tree'

// Locking and unlocking the drive's encryption, and saving its settings in the config message.

const REMEMBER_KEY = 'vault'

/** True if new uploads, folders and names must be encrypted. */
export function encrypting(drive: Drive): boolean {
  return !!drive.encryption && isUnlocked()
}

/** Encryption is on for this drive, but this device doesn't have the key yet. */
export function needsUnlock(drive: Drive): boolean {
  return !!drive.encryption && !isUnlocked()
}

/** Use the key remembered on this device, if it belongs to this drive. */
export async function restoreKeys(config: EncryptionConfig | undefined): Promise<boolean> {
  if (!config || isUnlocked()) return isUnlocked()
  const saved = await getKV<Keys>(REMEMBER_KEY)
  if (!saved || saved.id !== config.id) return false
  setKeys(saved)
  return true
}

async function useKeys(keys: Keys, remember: boolean) {
  setKeys(keys)
  // The keys can't be exported: IndexedDB stores them as opaque CryptoKey objects
  if (remember) await setKV(REMEMBER_KEY, keys)
  else await delKV(REMEMBER_KEY)
}

/** Throws WrongPasswordError if the password is wrong. */
export async function unlock(config: EncryptionConfig, password: string, remember: boolean): Promise<void> {
  await useKeys(await unlockKeys(config, password), remember)
}

/** Forget the key on this device (encrypted files show as locked again). */
export async function lock(): Promise<void> {
  setKeys(null)
  clearSecrets()
  await delKV(REMEMBER_KEY)
}

/** Turn on encryption for this drive. Existing files stay as they are; new ones are encrypted. */
export async function enableEncryption(drive: Drive, password: string, remember: boolean): Promise<void> {
  if (drive.encryption) throw new Error('Encryption is already on for this drive')
  const { config, keys } = await createEncryption(password)
  await writeConfig(drive, config)
  await useKeys(keys, remember)
}

export async function changeEncryptionPassword(drive: Drive, oldPassword: string, newPassword: string): Promise<void> {
  if (!drive.encryption) throw new Error('Encryption is not on for this drive')
  await writeConfig(drive, await changePassword(drive.encryption, oldPassword, newPassword))
}

/** Save the encryption settings in the drive's pinned config message (created if missing). */
async function writeConfig(drive: Drive, e: EncryptionConfig): Promise<void> {
  const client = await getClient()
  const message = encode({ td: 1, t: 'cfg', app: 'teledrive', e } satisfies ConfigMeta)
  if (drive.configMsgId) {
    const res = await client.invoke(new Api.messages.EditMessage({ peer: storagePeer(), id: drive.configMsgId, message }))
    await applyMessages(messagesFromUpdates(res))
    return
  }
  const res = await client.invoke(
    new Api.messages.SendMessage({ peer: storagePeer(), message, randomId: randomLong(), silent: true }),
  )
  const msgs = messagesFromUpdates(res)
  await applyMessages(msgs)
  if (msgs[0]) await client.invoke(new Api.messages.UpdatePinnedMessage({ peer: storagePeer(), id: msgs[0].id, silent: true }))
}
