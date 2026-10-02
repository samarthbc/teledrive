import { unseal } from './crypto'
import { isLevelOpen, levelKey, ROOT_LEVEL } from './keyring'
import { ROOT, type Secret } from './meta'
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
  const want = (sealed: string | undefined, level: string) => {
    if (sealed && !cache.has(sealed) && !failed.has(sealed) && isLevelOpen(level)) todo.push({ sealed, level })
  }
  for (const r of list) {
    const m = r.meta
    if (m.t !== 'd' && m.t !== 'f') continue
    want(m.e, levels.get(m.id)!)
    // A locked item's visible name is sealed with its folder's key
    want(m.ln, m.p === ROOT ? ROOT_LEVEL : (levels.get(m.p) ?? ROOT_LEVEL))
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
