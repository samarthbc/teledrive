import { isUnlocked, open } from './crypto'
import type { Secret } from './meta'
import type { MessageRecord } from './tree'

// Decrypted caption fields (names, types, hashes), kept in memory only.
const cache = new Map<string, Secret>()
/** Captions that failed to decrypt (e.g. damaged), so they aren't retried on every sync. */
const failed = new Set<string>()

export function secretOf(sealed: string): Secret | undefined {
  return cache.get(sealed)
}

/** Encrypted captions not decrypted yet (none while locked). */
export function unresolved(records: Iterable<MessageRecord>): string[] {
  if (!isUnlocked()) return []
  const todo: string[] = []
  for (const r of records) {
    const e = r.meta.t === 'd' || r.meta.t === 'f' ? r.meta.e : undefined
    if (e && !cache.has(e) && !failed.has(e)) todo.push(e)
  }
  return todo
}

/** Decrypt captions (from `unresolved`). */
export async function resolveSecrets(todo: string[]): Promise<void> {
  await Promise.all(
    todo.map(async (e) => {
      try {
        const s = await open<Secret>(e)
        if (typeof s?.n === 'string' && s.n) cache.set(e, s)
        else failed.add(e)
      } catch {
        failed.add(e)
      }
    }),
  )
}

/** Forget everything decrypted (when locking). */
export function clearSecrets(): void {
  cache.clear()
  failed.clear()
}

/** Remember fields we just encrypted ourselves, so they show up without decrypting. */
export function rememberSecret(sealed: string, secret: Secret): void {
  cache.set(sealed, secret)
}
