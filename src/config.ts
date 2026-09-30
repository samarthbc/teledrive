import { getKV, KEYS, setKV } from './db/db'

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
