import { App } from '@capacitor/app'
import { Network } from '@capacitor/network'
import { create } from 'zustand'
import { getKV, setKV } from '../db/db'
import { ROOT } from '../drive/meta'
import { createFolder } from '../drive/ops'
import { enqueue } from '../drive/queue'
import { isHidden, listFolder, uniqueName } from '../drive/tree'
import { uploadFile } from '../drive/upload'
import { useDrive } from '../store/useDrive'
import { isAndroid, Native, PhoneFile, type CameraItem } from './android'

/** Camera backup: uploads new photos/videos from DCIM/Camera into a "Camera Backup" folder. */

export interface BackupSettings {
  enabled: boolean
  wifiOnly: boolean
  /** Only media added at or after this time (unix seconds) is backed up. */
  since: number
  folderId?: string
}

const SETTINGS_KEY = 'backup'
const DONE_KEY = 'backupDone'
const FOLDER_NAME = 'Camera Backup'
const BATCH = 1000

interface BackupState {
  settings: BackupSettings
  status: string
  running: boolean
  backedUp: number
  lastCheck?: number
}

export const useBackup = create<BackupState>(() => ({
  settings: { enabled: false, wifiOnly: true, since: 0 },
  status: 'Off',
  running: false,
  backedUp: 0,
}))

let done = new Set<string>()
const queued = new Set<string>()
let loaded = false

async function load() {
  if (loaded) return
  loaded = true
  const settings = await getKV<BackupSettings>(SETTINGS_KEY)
  done = new Set((await getKV<string[]>(DONE_KEY)) ?? [])
  useBackup.setState({
    backedUp: done.size,
    ...(settings ? { settings, status: settings.enabled ? 'Waiting…' : 'Off' } : {}),
  })
}

export async function updateBackupSettings(changes: Partial<BackupSettings>): Promise<void> {
  await load()
  const settings = { ...useBackup.getState().settings, ...changes }
  useBackup.setState({ settings, status: settings.enabled ? 'Waiting…' : 'Off' })
  await setKV(SETTINGS_KEY, settings)
  if (settings.enabled) void runBackup()
}

/** Ask for permission to read photos/videos. */
export async function requestMediaPermission(): Promise<boolean> {
  return (await Native.mediaPermission({ request: true })).granted
}

async function markDone(id: string) {
  done.add(id)
  useBackup.setState({ backedUp: done.size })
  await setKV(DONE_KEY, [...done])
}

/** Look for new camera media and queue uploads. Safe to call often. */
export async function runBackup(): Promise<void> {
  await load()
  const { settings, running } = useBackup.getState()
  if (!isAndroid || !settings.enabled || running) return
  if (useDrive.getState().phase !== 'ready') return
  useBackup.setState({ running: true })
  try {
    if (!(await Native.mediaPermission({})).granted) {
      return useBackup.setState({ status: 'Needs permission to read photos and videos' })
    }
    const net = await Network.getStatus()
    if (!net.connected) return useBackup.setState({ status: 'Waiting for internet' })
    if (settings.wifiOnly && net.connectionType !== 'wifi') return useBackup.setState({ status: 'Waiting for Wi-Fi' })

    const folderId = await ensureFolder(settings)
    let since = settings.since
    let newItems: CameraItem[] = []
    for (;;) {
      const { items } = await Native.listCameraMedia({ since, limit: BATCH })
      newItems.push(...items.filter((i) => !done.has(i.id) && !queued.has(i.id)))
      if (items.length < BATCH) break
      since = items[items.length - 1].dateAdded + 1
    }
    // The same photo can show up twice across batches with equal timestamps
    newItems = [...new Map(newItems.map((i) => [i.id, i])).values()]

    for (const item of newItems) {
      queued.add(item.id)
      enqueue('upload', item.name, item.size, async (ctl) => {
        const drive = useDrive.getState().drive
        await uploadFile(new PhoneFile(item), uniqueName(drive, folderId, item.name), folderId, ctl)
        await markDone(item.id)
      })
    }
    useBackup.setState({
      status: newItems.length ? `Backing up ${newItems.length} item${newItems.length > 1 ? 's' : ''}` : 'Up to date',
      lastCheck: Date.now(),
    })
  } catch (e) {
    console.error('Camera backup failed', e)
    useBackup.setState({ status: `Error: ${e instanceof Error ? e.message : String(e)}` })
  } finally {
    useBackup.setState({ running: false })
  }
}

/** The backup folder: the saved one if it still exists, else a "Camera Backup" folder at the top level. */
async function ensureFolder(settings: BackupSettings): Promise<string> {
  const drive = useDrive.getState().drive
  const saved = settings.folderId ? drive.items.get(settings.folderId) : undefined
  if (saved?.kind === 'folder' && !isHidden(drive, saved)) return saved.id
  const existing = listFolder(drive, ROOT).find((i) => i.kind === 'folder' && i.name === FOLDER_NAME)
  const folderId = existing?.id ?? (await createFolder(drive, ROOT, FOLDER_NAME))
  await updateSettingsQuietly({ folderId })
  return folderId
}

async function updateSettingsQuietly(changes: Partial<BackupSettings>) {
  const settings = { ...useBackup.getState().settings, ...changes }
  useBackup.setState({ settings })
  await setKV(SETTINGS_KEY, settings)
}

/** Check for new photos when the app opens, comes back to the foreground, or joins Wi-Fi. */
export function initCameraBackup(): void {
  if (!isAndroid) return
  void runBackup()
  void App.addListener('appStateChange', ({ isActive }) => isActive && void runBackup())
  void Network.addListener('networkStatusChange', (s) => s.connected && void runBackup())
}
