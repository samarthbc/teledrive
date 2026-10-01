import { unseal } from './crypto'
import { isLevelOpen, levelKey } from './keyring'
import type { Secret } from './meta'
import { levelsOf, type KeyView, type MessageRecord } from './tree'

// Decrypted caption fields (names, types, hashes), kept in memory only and dropped when their level locks.
const cache = new Map<string, { level: string; secret: Secret }>()
/** Captions that failed to decrypt (e.g. damaged), so they aren't retried on every sync. */
const failed = new Set<string>()

export function secretOf(sealed: string): Secret | undefined {
  return cache.get(sealed)?.secret
}

/** What the tree may show: open levels and their decrypted names. */
export const keyView: KeyView = { isOpen: isLevelOpen, secretOf }

/** Encrypted captions whose level is open but that aren't decrypted yet. */
export function unresolved(records: Iterable<MessageRecord>): { sealed: string; level: string }[] {
  const list = [...records]
  const entries = new Map<string, { parent: string; locked: boolean }>()
  for (const r of list) {
    const m = r.meta
    if ((m.t === 'd' || m.t === 'f') && !entries.has(m.id)) entries.set(m.id, { parent: m.p, locked: !!m.l })
  }
  const levels = levelsOf(entries)
  const todo: { sealed: string; level: string }[] = []
  for (const r of list) {
    const m = r.meta
    if ((m.t !== 'd' && m.t !== 'f') || !m.e || cache.has(m.e) || failed.has(m.e)) continue
    const level = levels.get(m.id)!
    if (isLevelOpen(level)) todo.push({ sealed: m.e, level })
  }
  return todo
}

/** Decrypt captions (from `unresolved`). */
export async function resolveSecrets(todo: { sealed: string; level: string }[]): Promise<void> {
  await Promise.all(
    todo.map(async ({ sealed, level }) => {
      const key = levelKey(level)
      if (!key) return
      try {
        const secret = await unseal<Secret>(key, sealed)
        if (typeof secret?.n === 'string' && secret.n) cache.set(sealed, { level, secret })
        else failed.add(sealed)
      } catch {
        failed.add(sealed)
      }
    }),
  )
}

/** Forget names of levels that are closed now. */
export function purgeClosedSecrets(): void {
  for (const [sealed, { level }] of cache) if (!isLevelOpen(level)) cache.delete(sealed)
  failed.clear()
}

/** Remember fields we just encrypted ourselves, so they show up without decrypting. */
export function rememberSecret(sealed: string, level: string, secret: Secret): void {
  cache.set(sealed, { level, secret })
}
