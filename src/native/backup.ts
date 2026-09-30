import { App } from '@capacitor/app'
import { Network } from '@capacitor/network'
import { create } from 'zustand'
import { getKV, setKV } from '../db/db'
import { ROOT } from '../drive/meta'
import { createFolder } from '../drive/ops'
import { enqueue } from '../drive/queue'
import { isHidden, listFolder, uniqueName } from '../drive/tree'
import { uploadFile } from '../drive/upload'
import { encrypting, needsUnlock } from '../drive/vault'
import { useDrive } from '../store/useDrive'
import { currentDriveId, driveName } from '../telegram/channel'
import { isAndroid, Native, PhoneFile, type CameraItem } from './android'

/** Camera backup: uploads new photos/videos from DCIM/Camera into a "Camera Backup" folder. */

export interface BackupSettings {
  enabled: boolean
  wifiOnly: boolean
  /** Only media added at or after this time (unix seconds) is backed up. */
  since: number
  folderId?: string
  /** The drive photos go to (the one open when backup was turned on). */
  driveId?: string
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
  // Turning backup on in another drive moves it there
  if (changes.enabled && settings.driveId !== currentDriveId()) {
    settings.driveId = currentDriveId() ?? undefined
    delete settings.folderId
  }
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
    // Backups belong to one drive; older settings (from before multiple drives) adopt the open one
    if (!settings.driveId) await updateSettingsQuietly({ driveId: currentDriveId() ?? undefined })
    else if (settings.driveId !== currentDriveId()) {
      const target = useDrive.getState().drives.find((d) => d.id === settings.driveId)
      return useBackup.setState({ status: `Paused: open the “${target ? driveName(target) : 'backup'}” drive to back up` })
    }
    if (needsUnlock(useDrive.getState().drive)) return useBackup.setState({ status: 'Waiting: unlock encrypted files to back up' })
    const net = await Network.getStatus()
    if (!net.connected) return useBackup.setState({ status: 'Waiting for internet' })
    if (settings.wifiOnly && net.connectionType !== 'wifi') return useBackup.setState({ status: 'Waiting for Wi-Fi' })

    const folderId = await ensureFolder(settings)
    let since = settings.since
    let newItems: CameraItem[] = []
    for (;;) {
      const { items } = await Native.listCameraMedia({ since, limit: BATCH })
      // Safety net: the list must only contain items from `since` on, and each page must move forward
      if (items.some((i) => i.dateAdded < since)) throw new Error('Photo list returned items older than requested')
      newItems.push(...items.filter((i) => !done.has(i.id) && !queued.has(i.id)))
      if (items.length < BATCH) break
      const next = items[items.length - 1].dateAdded + 1
      if (next <= since) break
      since = next
    }
    // The same photo can show up twice across batches with equal timestamps
    newItems = [...new Map(newItems.map((i) => [i.id, i])).values()]

    // Turned off while we were looking? Then don't start anything.
    if (!useBackup.getState().settings.enabled) return

    for (const item of newItems) {
      queued.add(item.id)
      enqueue('upload', item.name, item.size, async (ctl) => {
        let failed = false
        try {
          const drive = useDrive.getState().drive
          if (needsUnlock(drive)) throw new Error('Encrypted files are locked')
          await uploadFile(new PhoneFile(item), uniqueName(drive, folderId, item.name), folderId, ctl, { encrypt: encrypting(drive) })
          await markDone(item.id)
        } catch (e) {
          failed = true
          throw e
        } finally {
          // Failed items are picked up again on the next check
          queued.delete(item.id)
          if (failed) useBackup.setState({ status: 'Some items failed; will retry' })
          else if (!queued.size) useBackup.setState({ status: 'Up to date', lastCheck: Date.now() })
        }
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

const AUTO_CHECK_GAP = 30_000
let lastAutoCheck = 0

/** Automatic checks are spaced out; "Back up now" calls runBackup() directly. */
function autoCheck() {
  if (Date.now() - lastAutoCheck < AUTO_CHECK_GAP) return
  lastAutoCheck = Date.now()
  void runBackup()
}

/** Check for new photos when the app opens, comes back to the foreground, or joins Wi-Fi. */
export function initCameraBackup(): void {
  if (!isAndroid) return
  autoCheck()
  void App.addListener('appStateChange', ({ isActive }) => isActive && autoCheck())
  // Some phones report a "change" every few seconds; only react when the connection type changes
  let lastType: string | null = null
  void Network.addListener('networkStatusChange', (s) => {
    const type = s.connected ? s.connectionType : 'none'
    if (type === lastType) return
    lastType = type
    if (s.connected) autoCheck()
  })
}
