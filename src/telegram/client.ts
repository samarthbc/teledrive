import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions'
import { LogLevel } from 'telegram/extensions/Logger'
import { loadKeys, type ApiKeys } from '../config'
import { getKV, KEYS, setKV } from '../db/db'

let client: TelegramClient | null = null
let keys: ApiKeys | null = null
let connecting: Promise<TelegramClient> | null = null

const CONNECT_TIMEOUT = 25_000

/** Telegram errors meaning this login no longer works and the user must log in again. */
export const SESSION_LOST_CODES = [
  'AUTH_KEY_UNREGISTERED', 'AUTH_KEY_DUPLICATED', 'SESSION_REVOKED', 'SESSION_EXPIRED', 'USER_DEACTIVATED',
]

const lostListeners = new Set<(code: string) => void>()

/** Called when Telegram ends the session (e.g. it was used from two places at once). */
export function onSessionLost(fn: (code: string) => void): () => void {
  lostListeners.add(fn)
  return () => lostListeners.delete(fn)
}

function checkSessionLost(err: unknown) {
  const code = (err as { errorMessage?: string })?.errorMessage ?? ''
  if (SESSION_LOST_CODES.includes(code)) for (const fn of lostListeners) fn(code)
}

// GramJS calls alert() when a reply arrives for a request it no longer waits for (e.g. a part
// that was re-sent after a reconnect). It's harmless and already handled, but the popup blocks the page.
const nativeAlert = window.alert.bind(window)
window.alert = (message?: unknown) => {
  if (String(message).startsWith('Missing MTProto Entity')) return console.warn(message)
  nativeAlert(message)
}

// GramJS reports some connection-level errors only as unhandled rejections
window.addEventListener('unhandledrejection', (e) => checkSessionLost(e.reason))

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
        client.onError = async (err) => checkSessionLost(err)
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        client.connect(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Couldn't reach Telegram. Check your internet connection and try again.")),
            CONNECT_TIMEOUT,
          )
        }),
      ]).finally(() => clearTimeout(timer))
      return client
    } finally {
      connecting = null
    }
  })()
  return connecting
}

/**
 * Telegram's clock minus this device's, in seconds (null before connecting). Telegram corrects it when the device's
 * clock is off, so a big value means the clock is wrong (2FA codes then don't work).
 */
export function telegramClockOffset(): number | null {
  const state = (client as unknown as { _sender?: { _state?: { timeOffset?: number } } } | null)?._sender?._state
  return typeof state?.timeOffset === 'number' ? state.timeOffset : null
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

// During development, hot-reloading this module would otherwise leave the old connection open next
// to a new one using the same login, which Telegram can treat as a duplicated session
import.meta.hot?.dispose(() => {
  void client?.destroy()
})
