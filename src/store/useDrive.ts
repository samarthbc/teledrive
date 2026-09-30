import { create } from 'zustand'
import { loadKeys } from '../config'
import { getKV, KEYS, setKV } from '../db/db'
import { cleanup } from '../drive/ops'
import { subscribeTransfers, type Transfer } from '../drive/queue'
import { initStreaming } from '../drive/stream'
import { loadCache, subscribe, sync } from '../drive/sync'
import { buildDrive, type Drive } from '../drive/tree'
import { describeError, errorCode, logOut } from '../telegram/auth'
import { ensureStorageChannel } from '../telegram/channel'
import { getClient, isAuthorized } from '../telegram/client'

export type Phase = 'boot' | 'setup' | 'login' | 'loading' | 'ready' | 'error'
export type ViewMode = 'grid' | 'list'
export type SortKey = 'name' | 'date' | 'size' | 'type'
export interface Sort {
  key: SortKey
  dir: 'asc' | 'desc'
}

interface State {
  phase: Phase
  error: string | null
  drive: Drive
  syncing: boolean
  syncError: string | null
  transfers: Transfer[]
  view: ViewMode
  sort: Sort
  boot: () => Promise<void>
  afterLogin: () => Promise<void>
  refresh: () => Promise<void>
  logout: () => Promise<void>
  setView: (v: ViewMode) => void
  setSort: (s: Sort) => void
}

const SYNC_INTERVAL = 30_000
const LOGGED_OUT_CODES = ['AUTH_KEY_UNREGISTERED', 'SESSION_REVOKED', 'USER_DEACTIVATED', 'AUTH_KEY_DUPLICATED']
let timer: ReturnType<typeof setInterval> | undefined
// Startup must never run twice at once (it could create two storage channels)
let booting: Promise<void> | null = null

export const useDrive = create<State>((set, get) => {
  subscribe((records) => set({ drive: buildDrive(records.values()) }))
  subscribeTransfers((transfers) => set({ transfers }))
  initStreaming((id) => {
    const item = get().drive.items.get(id)
    return item?.kind === 'file' ? item : undefined
  })

  const startDrive = async () => {
    set({ phase: 'loading', error: null })
    await ensureStorageChannel()
    const hasCache = await loadCache()
    if (hasCache) set({ phase: 'ready' })
    await get().refresh()
    set({ phase: 'ready' })
    startAutoSync()
    // Expire old trash and leftovers of abandoned uploads (in the background)
    cleanup(get().drive).catch((e) => console.error('Cleanup failed', e))
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

  const fail = (e: unknown) => {
    console.error(e)
    if (LOGGED_OUT_CODES.includes(errorCode(e))) void get().logout()
    else set({ phase: 'error', error: describeError(e) })
  }

  return {
    phase: 'boot',
    error: null,
    drive: buildDrive([]),
    syncing: false,
    syncError: null,
    transfers: [],
    view: 'grid',
    sort: { key: 'name', dir: 'asc' },

    boot: () => {
      booting ??= (async () => {
        set({ phase: 'boot', error: null })
        try {
          const [view, sort] = await Promise.all([getKV<ViewMode>(KEYS.view), getKV<Sort>(KEYS.sort)])
          set({ view: view ?? 'grid', sort: sort ?? { key: 'name', dir: 'asc' } })
          if (!(await loadKeys())) return set({ phase: 'setup' })
          await getClient()
          if (!(await isAuthorized())) return set({ phase: 'login' })
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
        if (LOGGED_OUT_CODES.includes(errorCode(e))) void get().logout()
        else set({ syncError: describeError(e) })
      } finally {
        set({ syncing: false })
      }
    },

    logout: async () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      await logOut()
      set({ drive: buildDrive([]), phase: 'login' })
    },

    setView: (view) => {
      set({ view })
      void setKV(KEYS.view, view)
    },

    setSort: (sort) => {
      set({ sort })
      void setKV(KEYS.sort, sort)
    },
  }
})
