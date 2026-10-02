import { Api } from 'telegram'
import { computeCheck } from 'telegram/Password'
import { clearAccountData } from '../db/db'
import { apiKeys, getClient, resetClient, saveSession } from './client'

export type SignInResult = 'ok' | 'password' | 'signup'

let pending: { phone: string; phoneCodeHash: string } | null = null

export async function sendCode(phone: string): Promise<{ viaApp: boolean }> {
  const client = await getClient()
  const normalized = phone.replace(/[\s()-]/g, '')
  const { phoneCodeHash, isCodeViaApp } = await client.sendCode(apiKeys(), normalized)
  pending = { phone: normalized, phoneCodeHash }
  return { viaApp: isCodeViaApp }
}

export async function signIn(code: string): Promise<SignInResult> {
  if (!pending) throw new Error('Request a code first')
  const client = await getClient()
  try {
    const result = await client.invoke(
      new Api.auth.SignIn({
        phoneNumber: pending.phone,
        phoneCodeHash: pending.phoneCodeHash,
        phoneCode: code.trim(),
      }),
    )
    if (result instanceof Api.auth.AuthorizationSignUpRequired) return 'signup'
  } catch (e) {
    if (errorCode(e) === 'SESSION_PASSWORD_NEEDED') return 'password'
    throw e
  }
  pending = null
  await saveSession()
  return 'ok'
}

export async function checkPassword(password: string): Promise<void> {
  const client = await getClient()
  const info = await client.invoke(new Api.account.GetPassword())
  const check = await computeCheck(info, password)
  await client.invoke(new Api.auth.CheckPassword({ password: check }))
  pending = null
  await saveSession()
}

export async function logOut(): Promise<void> {
  try {
    const client = await getClient()
    await client.invoke(new Api.auth.LogOut())
  } catch {
    // Still clear local data if the network call fails
  }
  await resetClient()
  await clearAccountData()
}

export function errorCode(e: unknown): string {
  return (e as { errorMessage?: string })?.errorMessage ?? ''
}

/** Human-friendly message for common Telegram errors. */
export function describeError(e: unknown): string {
  const code = errorCode(e)
  const seconds = (e as { seconds?: number })?.seconds
  const messages: Record<string, string> = {
    PHONE_NUMBER_INVALID: 'That phone number is not valid. Include the country code, e.g. +91…',
    PHONE_NUMBER_BANNED: 'This phone number is banned from Telegram.',
    PHONE_CODE_INVALID: 'Wrong code. Please check and try again.',
    PHONE_CODE_EXPIRED: 'The code expired. Request a new one.',
    PHONE_CODE_EMPTY: 'Enter the code you received.',
    PASSWORD_HASH_INVALID: 'Wrong password.',
    API_ID_INVALID: 'The API keys are invalid. Check api_id and api_hash.',
    AUTH_KEY_UNREGISTERED: 'You have been logged out. Please log in again.',
    SESSION_REVOKED: 'This session was terminated from another device. Please log in again.',
    FRESH_RESET_AUTHORISATION_FORBIDDEN:
      'Telegram only allows this from a device that has been logged in for at least 24 hours. Try again tomorrow, or use the Telegram app.',
  }
  if (code === 'FLOOD' || code.startsWith('FLOOD_WAIT') || seconds)
    return `Too many attempts. Please wait ${formatWait(seconds ?? 60)} and try again.`
  return messages[code] ?? (e instanceof Error ? e.message : String(e))
}

function formatWait(s: number): string {
  if (s < 90) return `${s} seconds`
  if (s < 5400) return `${Math.ceil(s / 60)} minutes`
  return `${Math.ceil(s / 3600)} hours`
}
