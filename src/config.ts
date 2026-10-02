import { delKV, getKV, KEYS, setKV } from './db/db'

export interface ApiKeys {
  apiId: number
  apiHash: string
}

/** Keys built into the app from .env (may be absent in public builds). */
export function builtInKeys(): ApiKeys | null {
  const apiId = Number(import.meta.env.VITE_TG_API_ID)
  const apiHash = import.meta.env.VITE_TG_API_HASH?.trim()
  return apiId > 0 && apiHash ? { apiId, apiHash } : null
}

/** Built-in keys win; otherwise use keys the user entered on the Setup page. */
export async function loadKeys(): Promise<ApiKeys | null> {
  const builtIn = builtInKeys()
  if (builtIn) return builtIn
  const apiId = await getKV<number>(KEYS.apiId)
  const apiHash = await getKV<string>(KEYS.apiHash)
  return apiId && apiHash ? { apiId, apiHash } : null
}

export function validateKeys(apiId: string, apiHash: string): string | null {
  if (!/^\d{3,12}$/.test(apiId.trim())) return 'api_id should be a number'
  if (!/^[0-9a-f]{32}$/i.test(apiHash.trim())) return 'api_hash should be 32 letters/digits'
  return null
}

export async function saveKeys(apiId: string, apiHash: string): Promise<void> {
  await setKV(KEYS.apiId, Number(apiId.trim()))
  await setKV(KEYS.apiHash, apiHash.trim().toLowerCase())
}

/** Remove keys entered on the Setup page (the app then asks for them again). */
export async function forgetSavedKeys(): Promise<void> {
  await delKV(KEYS.apiId)
  await delKV(KEYS.apiHash)
}

/**
 * Pull api_id and api_hash out of pasted text, e.g. both copied from my.telegram.org at once
 * ("App api_id: 1234567 App api_hash: 0123…cdef"). Returns what it found.
 */
export function parseKeys(text: string): { apiId?: string; apiHash?: string } {
  const apiHash = /\b[0-9a-f]{32}\b/i.exec(text)?.[0]
  const rest = apiHash ? text.replace(apiHash, ' ') : text
  const apiId = /\b\d{3,12}\b/.exec(rest)?.[0]
  return { apiId, apiHash: apiHash?.toLowerCase() }
}
