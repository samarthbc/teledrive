import { nanoid } from 'nanoid'
import { create } from 'zustand'
import { fromB64, importAes, toB64, WrongPasswordError } from '../drive/crypto'
import { accountKeys, onKeysChanged } from '../drive/keyring'
import type { VaultFolderMeta, VaultItemMeta } from '../drive/meta'
import { subscribe as subscribeRecords } from '../drive/sync'
import type { Drive, MessageRecord } from '../drive/tree'
import { verifyPassword } from '../drive/vault'
import { getSettings, useSettings } from '../lib/settings'
import { isAndroid, Native } from '../native/android'
import { telegramBackend, type VaultBackend } from '../vault/backend'
import { TRASH_DAYS, withPasswordHistory, type VaultFolder, type VaultItem } from '../vault/items'
import { forgetOtpKeys } from '../vault/totp'
import * as vc from '../vault/vaultCrypto'
import { useDrive } from './useDrive'

// TeleWarden's state (IMPLEMENTATION.md → "Phase 19"). The vault key and everything decrypted live in memory only;
// IndexedDB keeps the same ciphertext Telegram has.

export type VaultStatus = 'none' | 'locked' | 'open'

export class ConflictError extends Error {
  constructor(public theirs: VaultItem | null) {
    super(theirs ? 'This item was changed on another device' : 'This item was deleted on another device')
  }
}

/** Where things come from; the dev mock replaces them. */
export interface VaultDeps {
  backend: VaultBackend
  rootKey: () => CryptoKey | null
  drive: () => Drive
}
let deps: VaultDeps = {
  backend: telegramBackend,
  rootKey: () => accountKeys()?.root ?? null,
  drive: () => useDrive.getState().drive,
}

interface Located {
  msgId: number
  /** Sealed text as it was read (to skip decrypting it again). */
  e: string
}

interface VaultState {
  status: VaultStatus
  config: vc.VaultConfig | null
  /** Decrypted items, trash included. */
  items: VaultItem[]
  folders: VaultFolder[]
  /** Messages that couldn't be decrypted. */
  damaged: number
  /** Items that came back older than this device last saw (IDs). */
  rollbacks: string[]
  /** Wrong master passwords in a row, and when the next try is allowed. */
  tries: number
  waitUntil: number
  /** Last activity while open (the idle timer counts from here). */
  lastActive: number
  /** Why it locked last, for a toast (cleared once shown). */
  lockedBecause: string | null
  /**
   * A new recovery code is on screen (after setting up or recovering): the setup / lock screen stays until the
   * person says they saved it, although the vault is already open.
   */
  pendingCode: 'setup' | 'recover' | null
  /** A PIN is set on this device. */
  pinSet: boolean
  /** The PIN can unlock now (after one master-password unlock since TeleDrive started). */
  pinReady: boolean
  /** Fingerprint unlock is on (Android). */
  bioSet: boolean
  /** The master password was entered since TeleDrive started (the fingerprint works from then on). */
  sessionUnlocked: boolean

  /** Settings → Unlock with a PIN (asks the master password). */
  setPin: (master: string, pin: string) => Promise<void>
  removePin: () => void
  unlockWithPin: (pin: string) => Promise<void>
  /** Settings → Unlock with fingerprint (asks the master password, then a fingerprint). False if cancelled. */
  enableBio: (master: string) => Promise<boolean>
  disableBio: () => Promise<void>
  /** False if the person chose the master password instead. */
  unlockWithBio: () => Promise<boolean>

  create: (password: string, hint: string) => Promise<string>
  unlock: (password: string) => Promise<void>
  checkCode: (code: string) => Promise<boolean>
  /** Is this the master password? (Changes nothing; for the one-week reminder.) */
  checkPassword: (password: string) => Promise<boolean>
  recover: (code: string, newPassword: string) => Promise<string>
  changePassword: (current: string, next: string) => Promise<void>
  newCode: (password: string) => Promise<string>
  readHint: () => Promise<string | null>
  /** Forgot the master password and the code: delete the vault (asks the TeleDrive password). */
  reset: (teledrivePassword: string) => Promise<void>
  lock: (because?: string) => void
  touch: () => void

  /** Save an item. `base`: the revision it was edited from (a newer one from another device throws ConflictError). */
  save: (item: VaultItem, base?: number) => Promise<VaultItem>
  trash: (ids: string[]) => Promise<void>
  restore: (ids: string[]) => Promise<void>
  deleteForever: (ids: string[]) => Promise<void>
  emptyTrash: () => Promise<void>
  saveFolder: (folder: VaultFolder) => Promise<void>
  /** Items in it move out (to no folder). */
  deleteFolder: (id: string) => Promise<void>
  /** Accept an older version that came back (stop warning about it). */
  acceptRollback: (id: string) => void
}

let key: CryptoKey | null = null
/** The config the key was opened with (a reset elsewhere makes a new key). */
let keyFrom: number | null = null
let records: MessageRecord[] = []
const where = new Map<string, Located>()
/** Decrypted messages by `${id}:${sealed}`. */
const cache = new Map<string, VaultItem | VaultFolder | null>()
let seq = 0
/** The PIN's copy of the vault key (memory only: gone when TeleDrive closes). */
let pinWrapped: vc.PinWrap | null = null
let pinTries = 0
let idle: ReturnType<typeof setTimeout> | undefined
/** The store's refresh (set when the store is made). */
let refreshImpl: () => Promise<void> = async () => {}

const TRIES_KEY = 'teledrive.vaultTries'
/** The PIN, sealed with the vault key, so the PIN works again after the master password (Bitwarden does the same). */
const PIN_KEY = 'teledrive.vaultPin'
/** Fingerprint unlock is set up for this vault (its creation time). */
const BIO_KEY = 'teledrive.vaultBio'
const SEEN_KEY = 'teledrive.vaultSeen'
const FREE_TRIES = 5

function loadJson<T>(k: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(k) ?? 'null') as T) ?? fallback
  } catch {
    return fallback
  }
}
function saveJson(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    // Storage blocked: kept in memory only
  }
}

/** The newest revision this device has seen of each item (to notice an old version coming back). */
const seen: Record<string, number> = loadJson(SEEN_KEY, {})
const nowSec = () => Math.floor(Date.now() / 1000)

export const useVault = create<VaultState>((set, get) => {
  const savedTries = loadJson<{ tries: number; waitUntil: number }>(TRIES_KEY, { tries: 0, waitUntil: 0 })

  const configOf = (list: MessageRecord[]): vc.VaultConfig | null => {
    let cfg: MessageRecord | undefined
    for (const r of list) if (r.meta.t === 'cfg' && (!cfg || r.msgId < cfg.msgId)) cfg = r
    return cfg?.meta.t === 'cfg' ? (cfg.meta.w ?? null) : null
  }

  const statusOf = (config: vc.VaultConfig | null): VaultStatus => (!config ? 'none' : key ? 'open' : 'locked')

  /** Read the records again: decrypt what's new (when open), work out items and folders. */
  const refresh = async () => {
    const mine = ++seq
    const config = configOf(records)
    deviceUnlocks(config)
    // Reset on another device (a new vault key): this key no longer fits
    if (key && config && keyFrom !== null && config.ct !== keyFrom) closeKey()
    if (!key) {
      where.clear()
      set({ config, status: statusOf(config), items: [], folders: [], damaged: 0, rollbacks: [] })
      return
    }
    const vaultRecords = records.filter((r) => r.meta.t === 'v' || r.meta.t === 'vf')
    const k = key
    await Promise.all(
      vaultRecords.map(async (r) => {
        const m = r.meta as VaultItemMeta | VaultFolderMeta
        const ck = `${m.id}:${m.e}`
        if (cache.has(ck)) return
        try {
          cache.set(ck, await vc.unsealItem<VaultItem | VaultFolder>(k, m.id, m.e))
        } catch {
          cache.set(ck, null)
        }
      }),
    )
    if (mine !== seq || key !== k) return
    const items = new Map<string, VaultItem>()
    const folders = new Map<string, VaultFolder>()
    where.clear()
    let damaged = 0
    for (const r of vaultRecords) {
      const m = r.meta as VaultItemMeta | VaultFolderMeta
      const value = cache.get(`${m.id}:${m.e}`)
      if (!value) {
        damaged++
        continue
      }
      const target = m.t === 'v' ? items : folders
      const prev = target.get(m.id)
      // Two messages for one ID (shouldn't happen): the newest revision wins
      if (prev && prev.rd >= value.rd) continue
      target.set(m.id, value as never)
      where.set(m.id, { msgId: r.msgId, e: m.e })
    }
    const rollbacks = [...items.values()].filter((i) => seen[i.id] && i.rd < seen[i.id]).map((i) => i.id)
    for (const i of items.values()) if (!seen[i.id] || i.rd > seen[i.id]) seen[i.id] = i.rd
    saveJson(SEEN_KEY, seen)
    set({ config, status: statusOf(config), items: [...items.values()], folders: [...folders.values()], damaged, rollbacks })
  }

  /** PIN and fingerprint set up on this device for this vault. */
  const deviceUnlocks = (config: vc.VaultConfig | null) => {
    if (!config) return
    const pin = loadJson<{ ct: number } | null>(PIN_KEY, null)
    const bio = loadJson<number | null>(BIO_KEY, null)
    const pinSet = pin?.ct === config.ct
    const bioSet = isAndroid && bio === config.ct
    if (pinSet !== get().pinSet || bioSet !== get().bioSet) set({ pinSet, bioSet, pinReady: pinSet && !!pinWrapped })
  }

  refreshImpl = refresh

  const closeKey = () => {
    key = null
    keyFrom = null
    cache.clear()
    where.clear()
    forgetOtpKeys()
    clearTimeout(idle)
  }

  const setTries = (tries: number) => {
    const waitUntil = tries >= FREE_TRIES ? Date.now() + 30_000 * 2 ** (tries - FREE_TRIES) : 0
    saveJson(TRIES_KEY, { tries, waitUntil })
    set({ tries, waitUntil })
  }

  const opened = async (k: CryptoKey, config: vc.VaultConfig) => {
    key = k
    keyFrom = config.ct
    setTries(0)
    set({ status: 'open', config, lockedBecause: null })
    get().touch()
    await refresh()
    // Expire old trash (any device that opens the vault does it)
    const old = get().items.filter((i) => i.tr && i.tr < nowSec() - TRASH_DAYS * 86_400).map((i) => i.id)
    if (old.length) get().deleteForever(old).catch((e) => console.warn('Trash cleanup failed', e))
  }

  const needRoot = () => {
    const root = deps.rootKey()
    if (!root) throw new Error('Enter your TeleDrive password first')
    return root
  }
  const needConfig = () => {
    const c = get().config
    if (!c) throw new Error('TeleWarden isn’t set up yet')
    return c
  }
  const needKey = () => {
    if (!key) throw new Error('TeleWarden is locked')
    return key
  }

  const write = async (id: string, kind: 'v' | 'vf', value: object) => {
    const e = await vc.sealItem(needKey(), id, value)
    const meta = { td: 1 as const, t: kind, id, ts: nowSec(), e }
    const at = where.get(id)
    if (at) await deps.backend.edit(at.msgId, meta)
    else await deps.backend.send(meta)
  }

  const saveItems = async (list: VaultItem[]) => {
    for (const item of list) {
      await write(item.id, 'v', stripId(item))
      seen[item.id] = item.rd
    }
    saveJson(SEEN_KEY, seen)
  }

  return {
    status: 'none',
    config: null,
    items: [],
    folders: [],
    damaged: 0,
    rollbacks: [],
    tries: savedTries.tries,
    waitUntil: savedTries.waitUntil,
    lastActive: Date.now(),
    lockedBecause: null,
    pendingCode: null,
    pinSet: false,
    pinReady: false,
    bioSet: false,
    sessionUnlocked: false,

    create: async (password, hint) => {
      if (get().config) throw new Error('TeleWarden is already set up')
      const { config, key: k, code } = await vc.createVault(needRoot(), password, hint)
      // Set first: the drive reads the config back while it's written, and the setup screen must stay (with the code)
      set({ pendingCode: 'setup' })
      try {
        await deps.backend.writeConfig(deps.drive(), config)
      } catch (e) {
        set({ pendingCode: null })
        throw e
      }
      set({ config })
      await opened(k, config)
      return code
    },

    unlock: async (password) => {
      if (get().waitUntil > Date.now()) throw new Error('Too many wrong tries. Wait a moment.')
      const config = needConfig()
      let raw: Uint8Array<ArrayBuffer>
      try {
        raw = await vc.rawWithPassword(config, needRoot(), password)
      } catch (e) {
        if (e instanceof WrongPasswordError) setTries(get().tries + 1)
        throw e
      }
      const k = await importAes(raw.slice())
      await opened(k, config)
      set({ sessionUnlocked: true })
      // A PIN set earlier: make its copy of the key again (it was in memory only)
      const sealedPin = loadJson<{ ct: number; e: string } | null>(PIN_KEY, null)
      if (sealedPin?.ct === config.ct) {
        try {
          const { pin } = await vc.unsealItem<{ pin: string }>(k, 'pin', sealedPin.e)
          pinWrapped = await vc.pinWrap(raw, pin)
          pinTries = 0
        } catch {
          // Damaged: the PIN is set again in Settings
        }
      }
      raw.fill(0)
      set({ pinReady: !!pinWrapped })
    },

    setPin: async (master, pin) => {
      if (!/^\d{4,8}$/.test(pin)) throw new Error('Use 4 to 8 digits')
      const config = needConfig()
      const raw = await vc.rawWithPassword(config, needRoot(), master)
      pinWrapped = await vc.pinWrap(raw, pin)
      raw.fill(0)
      pinTries = 0
      saveJson(PIN_KEY, { ct: config.ct, e: await vc.sealItem(needKey(), 'pin', { pin }) })
      set({ pinSet: true, pinReady: true })
    },

    removePin: () => {
      pinWrapped = null
      try {
        localStorage.removeItem(PIN_KEY)
      } catch {
        // Nothing stored
      }
      set({ pinSet: false, pinReady: false })
    },

    unlockWithPin: async (pin) => {
      if (!pinWrapped) throw new Error('Use your master password')
      const config = needConfig()
      try {
        await opened(await vc.pinUnwrap(pinWrapped, pin), config)
        pinTries = 0
      } catch (e) {
        if (!(e instanceof WrongPasswordError)) throw e
        if (++pinTries >= FREE_TRIES) {
          pinWrapped = null
          set({ pinReady: false })
          throw new Error('Too many wrong PINs. Use your master password.')
        }
        throw new Error(`Wrong PIN · ${FREE_TRIES - pinTries} ${FREE_TRIES - pinTries === 1 ? 'try' : 'tries'} left`)
      }
    },

    enableBio: async (master) => {
      const config = needConfig()
      const raw = await vc.rawWithPassword(config, needRoot(), master)
      try {
        const res = await Native.biometricEnable({ data: toB64(raw) })
        if (res.cancelled) return false
      } finally {
        raw.fill(0)
      }
      saveJson(BIO_KEY, config.ct)
      set({ bioSet: true })
      return true
    },

    disableBio: async () => {
      await Native.biometricDisable().catch(() => {})
      try {
        localStorage.removeItem(BIO_KEY)
      } catch {
        // Nothing stored
      }
      set({ bioSet: false })
    },

    unlockWithBio: async () => {
      const config = needConfig()
      let res: { data?: string; cancelled?: boolean }
      try {
        res = await Native.biometricUnlock()
      } catch (e) {
        // Fingerprints changed on the phone: turned off (the native side cleared it)
        if ((e as { code?: string }).code === 'INVALIDATED') await get().disableBio()
        throw e
      }
      if (res.cancelled || !res.data) return false
      const raw = fromB64(res.data)
      try {
        await opened(await importAes(raw), config)
      } catch {
        await get().disableBio()
        throw new Error('Fingerprint unlock no longer fits this vault. Use your master password and turn it on again.')
      }
      return true
    },

    checkCode: async (code) => vc.checkRecoveryCode(needConfig(), needRoot(), code),

    checkPassword: async (password) => {
      try {
        await vc.openWithPassword(needConfig(), needRoot(), password)
        return true
      } catch (e) {
        if (e instanceof WrongPasswordError) return false
        throw e
      }
    },

    recover: async (code, newPassword) => {
      const { config, key: k, code: next } = await vc.recover(needConfig(), needRoot(), code, newPassword)
      set({ pendingCode: 'recover' })
      try {
        await deps.backend.writeConfig(deps.drive(), config)
      } catch (e) {
        set({ pendingCode: null })
        throw e
      }
      set({ sessionUnlocked: true })
      await opened(k, config)
      return next
    },

    changePassword: async (current, next) => {
      const config = await vc.changePassword(needConfig(), needRoot(), current, next)
      await deps.backend.writeConfig(deps.drive(), config)
      set({ config })
    },

    newCode: async (password) => {
      const { config, code } = await vc.newCode(needConfig(), needRoot(), password)
      await deps.backend.writeConfig(deps.drive(), config)
      set({ config })
      return code
    },

    readHint: async () => {
      const c = get().config
      const root = deps.rootKey()
      return c && root ? vc.readHint(c, root) : null
    },

    reset: async (teledrivePassword) => {
      if (!(await verifyPassword(teledrivePassword))) throw new WrongPasswordError()
      const ids = records.filter((r) => r.meta.t === 'v' || r.meta.t === 'vf').map((r) => r.msgId)
      if (ids.length) await deps.backend.remove(ids)
      await deps.backend.writeConfig(deps.drive(), null)
      closeKey()
      setTries(0)
      get().removePin()
      if (get().bioSet) await get().disableBio()
      for (const k of Object.keys(seen)) delete seen[k]
      saveJson(SEEN_KEY, seen)
      set({ config: null, status: 'none', items: [], folders: [], damaged: 0, rollbacks: [] })
    },

    lock: (because) => {
      if (!key) return
      closeKey()
      set({ status: get().config ? 'locked' : 'none', items: [], folders: [], damaged: 0, rollbacks: [], lockedBecause: because ?? null })
    },

    touch: () => {
      clearTimeout(idle)
      if (!key) return
      set({ lastActive: Date.now() })
      const minutes = getSettings().vaultLockMinutes
      if (minutes) idle = setTimeout(() => get().lock(`Locked after ${minutes} minute${minutes === 1 ? '' : 's'} without activity`), minutes * 60_000)
    },

    save: async (item, base) => {
      const prev = get().items.find((i) => i.id === item.id)
      if (prev && base !== undefined) {
        // Changed on another device since it was opened for editing?
        await deps.backend.sync()
        await refresh()
        const now = get().items.find((i) => i.id === item.id)
        if (!now) throw new ConflictError(null)
        if (now.rd !== base) throw new ConflictError(now)
      }
      const next = { ...withPasswordHistory(prev, item), rd: Date.now() } as VaultItem
      await saveItems([next])
      return next
    },

    trash: async (ids) => {
      const tr = nowSec()
      await saveItems(get().items.filter((i) => ids.includes(i.id)).map((i) => ({ ...i, tr, rd: Date.now() })))
    },

    restore: async (ids) => {
      await saveItems(
        get().items.filter((i) => ids.includes(i.id)).map((i) => {
          const { tr: _tr, ...rest } = i
          return { ...rest, rd: Date.now() } as VaultItem
        }),
      )
    },

    deleteForever: async (ids) => {
      const msgIds = ids.flatMap((id) => where.get(id)?.msgId ?? [])
      if (msgIds.length) await deps.backend.remove(msgIds)
    },

    emptyTrash: async () => get().deleteForever(get().items.filter((i) => i.tr).map((i) => i.id)),

    saveFolder: async (folder) => {
      const n = folder.n.trim()
      if (!n) throw new Error('Give the folder a name')
      if (get().folders.some((f) => f.id !== folder.id && f.n.toLowerCase() === n.toLowerCase())) throw new Error('A folder with this name already exists')
      await write(folder.id, 'vf', { n, rd: Date.now() })
    },

    deleteFolder: async (id) => {
      const inside = get().items.filter((i) => i.f === id)
      await saveItems(inside.map((i) => {
        const { f: _f, ...rest } = i
        return { ...rest, rd: Date.now() } as VaultItem
      }))
      const at = where.get(id)
      if (at) await deps.backend.remove([at.msgId])
    },

    acceptRollback: (id) => {
      const item = get().items.find((i) => i.id === id)
      if (item) seen[id] = item.rd
      saveJson(SEEN_KEY, seen)
      set({ rollbacks: get().rollbacks.filter((x) => x !== id) })
    },
  }
})

function stripId(item: VaultItem): Omit<VaultItem, 'id'> {
  const { id: _id, ...rest } = item
  return rest
}

/** A new item or folder ID. */
export const newVaultId = () => nanoid(10)

// ---- wiring ----

let pending: Promise<void> = Promise.resolve()

/** Feed records (the open drive's, or the dev mock's). */
export function feedVault(list: MessageRecord[]): void {
  records = list
  pending = pending.then(refreshImpl).catch((e) => console.error('TeleWarden refresh failed', e))
}

/** The dev mock: memory instead of Telegram. */
export function configureVault(d: Partial<VaultDeps>): void {
  deps = { ...deps, ...d }
}

subscribeRecords((map) => feedVault([...map.values()]))
// Logging out (or "Lock everything now" forgetting the TeleDrive password) locks the vault too
onKeysChanged(() => !accountKeys() && useVault.getState().lock())
// A new lock time counts from now
useSettings.subscribe((s, prev) => s.vaultLockMinutes !== prev.vaultLockMinutes && useVault.getState().touch())
