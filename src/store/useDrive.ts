import { create } from 'zustand'
import { loadKeys } from '../config'
import { clearAccountData, getKV, KEYS, setKV } from '../db/db'
import { cleanup } from '../drive/ops'
import { subscribeTransfers, type Transfer } from '../drive/queue'
import { initStreaming } from '../drive/stream'
import { loadCache, subscribe, sync } from '../drive/sync'
import { resolveSecrets, secretOf, unresolved } from '../drive/secrets'
import { buildDrive, type Drive, type MessageRecord } from '../drive/tree'
import * as vault from '../drive/vault'
import { describeError, errorCode, logOut } from '../telegram/auth'
import { ensureStorageChannel } from '../telegram/channel'
import { getClient, isAuthorized, onSessionLost, resetClient, SESSION_LOST_CODES } from '../telegram/client'
import { acquireSessionLock, onSessionTakenOver } from '../telegram/sessionLock'

export type Phase = 'boot' | 'setup' | 'login' | 'loading' | 'ready' | 'error' | 'otherTab'
export type ViewMode = 'grid' | 'list'
export type SortKey = 'name' | 'date' | 'size' | 'type'
export interface Sort {
  key: SortKey
  dir: 'asc' | 'desc'
}

interface State {
  phase: Phase
  error: string | null
  /** Shown on the login screen, e.g. why the user was logged out. */
  loginNotice: string | null
  drive: Drive
  syncing: boolean
  syncError: string | null
  transfers: Transfer[]
  view: ViewMode
  sort: Sort
  /** The encryption key is available on this device (only meaningful if the drive has encryption on). */
  unlocked: boolean
  boot: (takeOver?: boolean) => Promise<void>
  afterLogin: () => Promise<void>
  refresh: () => Promise<void>
  logout: () => Promise<void>
  setView: (v: ViewMode) => void
  setSort: (s: Sort) => void
  /** Throws WrongPasswordError if the password is wrong. */
  unlock: (password: string, remember: boolean) => Promise<void>
  lock: () => Promise<void>
  enableEncryption: (password: string, remember: boolean) => Promise<void>
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>
}

const SYNC_INTERVAL = 30_000
const LOGGED_OUT_CODES = SESSION_LOST_CODES
const SESSION_LOST_NOTICE: Record<string, string> = {
  AUTH_KEY_DUPLICATED: 'Telegram ended this session because it was used from two places at once. Please log in again.',
  SESSION_REVOKED: 'This session was ended from another device. Please log in again.',
}
let hasLock = false
let timer: ReturnType<typeof setInterval> | undefined
// Startup must never run twice at once (it could create two storage channels)
let booting: Promise<void> | null = null

export const useDrive = create<State>((set, get) => {
  let records: Map<number, MessageRecord> = new Map()
  let buildSeq = 0
  /** Rebuild the tree, decrypting new encrypted names first (synchronous when there are none). */
  const rebuild = async () => {
    const seq = ++buildSeq
    const todo = unresolved(records.values())
    if (todo.length) {
      await resolveSecrets(todo)
      if (seq !== buildSeq) return
    }
    set({ drive: buildDrive(records.values(), secretOf) })
  }
  subscribe((r) => {
    records = r
    void rebuild()
  })
  subscribeTransfers((transfers) => set({ transfers }))
  initStreaming((id) => {
    const item = get().drive.items.get(id)
    return item?.kind === 'file' ? item : undefined
  })

  const startDrive = async () => {
    set({ phase: 'loading', error: null })
    await ensureStorageChannel()
    const hasCache = await loadCache()
    await restoreKeys()
    if (hasCache) set({ phase: 'ready' })
    await get().refresh()
    await restoreKeys()
    set({ phase: 'ready' })
    startAutoSync()
    // Expire old trash and leftovers of abandoned uploads (in the background)
    cleanup(get().drive).catch((e) => console.error('Cleanup failed', e))
  }

  /** Use the encryption key remembered on this device, if any. */
  const restoreKeys = async () => {
    if (get().unlocked || !(await vault.restoreKeys(get().drive.encryption))) return
    set({ unlocked: true })
    await rebuild()
  }

  const forgetKeys = async () => {
    await vault.lock()
    set({ unlocked: false })
  }

  const startAutoSync = () => {
    clearInterval(timer)
    timer = setInterval(() => {
      if (document.visibilityState === 'visible') void get().refresh()
    }, SYNC_INTERVAL)
    document.addEventListener('visibilitychange', onVisible)
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible' && get().phase === 'ready') void get().refresh()
  }

  /** The session can't be used any more: forget it locally and go to the login screen. */
  const sessionLost = async (code: string) => {
    if (get().phase === 'login') return
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
    await resetClient()
    await forgetKeys()
    await clearAccountData()
    set({
      drive: buildDrive([]),
      phase: 'login',
      loginNotice: SESSION_LOST_NOTICE[code] ?? 'You have been logged out. Please log in again.',
    })
  }
  onSessionLost((code) => void sessionLost(code))

  // Another tab took over: stop using the session here
  onSessionTakenOver(() => {
    hasLock = false
    clearInterval(timer)
    void resetClient()
    set({ phase: 'otherTab' })
  })

  const fail = (e: unknown) => {
    console.error(e)
    if (LOGGED_OUT_CODES.includes(errorCode(e))) void sessionLost(errorCode(e))
    else set({ phase: 'error', error: describeError(e) })
  }

  return {
    phase: 'boot',
    error: null,
    loginNotice: null,
    drive: buildDrive([]),
    syncing: false,
    syncError: null,
    transfers: [],
    view: 'grid',
    sort: { key: 'name', dir: 'asc' },
    unlocked: false,

    boot: (takeOver = false) => {
      booting ??= (async () => {
        set({ phase: 'boot', error: null })
        try {
          if (!hasLock) {
            hasLock = await acquireSessionLock(takeOver)
            if (!hasLock) return set({ phase: 'otherTab' })
          }
          const [view, sort] = await Promise.all([getKV<ViewMode>(KEYS.view), getKV<Sort>(KEYS.sort)])
          set({ view: view ?? 'grid', sort: sort ?? { key: 'name', dir: 'asc' } })
          if (!(await loadKeys())) return set({ phase: 'setup' })
          await getClient()
          if (!(await isAuthorized())) {
            // Start login with a fresh key; a saved session that stopped working can't be reused
            await resetClient()
            await clearAccountData()
            return set({ phase: 'login' })
          }
          await startDrive()
        } catch (e) {
          fail(e)
        }
      })().finally(() => (booting = null))
      return booting
    },

    afterLogin: async () => {
      try {
        await startDrive()
      } catch (e) {
        fail(e)
      }
    },

    refresh: async () => {
      if (get().syncing) return
      set({ syncing: true })
      try {
        await sync()
        set({ syncError: null })
      } catch (e) {
        console.error('Sync failed', e)
        if (LOGGED_OUT_CODES.includes(errorCode(e))) void sessionLost(errorCode(e))
        else set({ syncError: describeError(e) })
      } finally {
        set({ syncing: false })
      }
    },

    logout: async () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      await logOut()
      await forgetKeys()
      set({ drive: buildDrive([]), phase: 'login', loginNotice: null })
    },

    setView: (view) => {
      set({ view })
      void setKV(KEYS.view, view)
    },

    setSort: (sort) => {
      set({ sort })
      void setKV(KEYS.sort, sort)
    },

    unlock: async (password, remember) => {
      const config = get().drive.encryption
      if (!config) throw new Error('Encryption is not on for this drive')
      await vault.unlock(config, password, remember)
      set({ unlocked: true })
      await rebuild()
    },

    lock: async () => {
      await forgetKeys()
      await rebuild()
    },

    enableEncryption: async (password, remember) => {
      await vault.enableEncryption(get().drive, password, remember)
      set({ unlocked: true })
      await rebuild()
    },

    changePassword: (oldPassword, newPassword) => vault.changeEncryptionPassword(get().drive, oldPassword, newPassword),
  }
})
