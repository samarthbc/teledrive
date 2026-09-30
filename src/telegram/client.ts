import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions'
import { LogLevel } from 'telegram/extensions/Logger'
import { loadKeys, type ApiKeys } from '../config'
import { getKV, KEYS, setKV } from '../db/db'

let client: TelegramClient | null = null
let keys: ApiKeys | null = null
let connecting: Promise<TelegramClient> | null = null

export class MissingKeysError extends Error {
  constructor() {
    super('Telegram API keys are not configured')
  }
}

export function apiKeys(): ApiKeys {
  if (!keys) throw new MissingKeysError()
  return keys
}

/** Connected client (created on first use, with the saved session if any). */
export function getClient(): Promise<TelegramClient> {
  if (client?.connected) return Promise.resolve(client)
  connecting ??= (async () => {
    try {
      keys = await loadKeys()
      if (!keys) throw new MissingKeysError()
      if (!client) {
        const saved = (await getKV<string>(KEYS.session)) ?? ''
        client = new TelegramClient(new StringSession(saved), keys.apiId, keys.apiHash, {
          connectionRetries: 5,
          useWSS: true,
          floodSleepThreshold: 60,
          deviceModel: 'TeleDrive',
          appVersion: '0.1.0',
        })
        client.setLogLevel(import.meta.env.DEV ? LogLevel.WARN : LogLevel.ERROR)
      }
      await client.connect()
      return client
    } finally {
      connecting = null
    }
  })()
  return connecting
}

export async function saveSession(): Promise<void> {
  if (client) await setKV(KEYS.session, (client.session as StringSession).save())
}

export async function isAuthorized(): Promise<boolean> {
  const c = await getClient()
  return c.checkAuthorization()
}

/** Drop the client (after logout) so the next getClient() starts a fresh session. */
export async function resetClient(): Promise<void> {
  const c = client
  client = null
  if (c) await c.destroy().catch(() => {})
}
