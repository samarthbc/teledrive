import bigInt from 'big-integer'
import { Api } from 'telegram'
import { getClient } from './client'

// Settings → Active sessions: every device logged in to this Telegram account (TeleDrive and Telegram's own
// apps), and logging them out.

export interface Session {
  /** Telegram's id for the session (a 64-bit number, as text). */
  hash: string
  current: boolean
  /** e.g. "Redmi 23124RN87I · Android 14". */
  device: string
  /** e.g. "Telegram Android 11.2" or "TeleDrive 1.0.0". */
  app: string
  /** e.g. "Karnataka, India". */
  place: string
  /** Unix seconds. */
  lastActive: number
}

export const sessions = {
  async list(): Promise<Session[]> {
    const client = await getClient()
    const res = await client.invoke(new Api.account.GetAuthorizations())
    return res.authorizations
      .map((a) => ({
        hash: a.hash.toString(),
        current: !!a.current,
        device: [a.deviceModel, [a.platform, a.systemVersion].filter(Boolean).join(' ')].filter(Boolean).join(' · '),
        app: [a.appName, a.appVersion].filter(Boolean).join(' '),
        place: [a.region, a.country].filter(Boolean).join(', '),
        lastActive: a.dateActive,
      }))
      .sort((x, y) => Number(y.current) - Number(x.current) || y.lastActive - x.lastActive)
  },

  /** Log one other device out. */
  async end(hash: string): Promise<void> {
    const client = await getClient()
    await client.invoke(new Api.account.ResetAuthorization({ hash: bigInt(hash) }))
  },

  /** Log every device out except this one. */
  async endOthers(): Promise<void> {
    const client = await getClient()
    await client.invoke(new Api.auth.ResetAuthorizations())
  },
}
