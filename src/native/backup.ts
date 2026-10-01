import { App } from '@capacitor/app'
import { Network } from '@capacitor/network'
import { create } from 'zustand'
import { getKV, setKV } from '../db/db'
import { ROOT } from '../drive/meta'
import { createFolder } from '../drive/ops'
import { enqueue, subscribeTransfers, type Transfer } from '../drive/queue'
import { isHidden, listFolder, uniqueName, type Drive } from '../drive/tree'
import { uploadFile } from '../drive/upload'
import { hasAccountKeys, ROOT_LEVEL } from '../drive/keyring'
import { currentDriveId } from '../telegram/channel'
import { isAndroid, isHeadless, Native, PhoneFile, type CameraItem } from './android'

/**
 * Camera backup: uploads new photos/videos from chosen folders (DCIM/Camera by default) into a
 * "Camera Backup" folder; other folders go into subfolders of it ("Camera Backup/Screenshots").
 * Runs in the app, and in the background page while the app is closed (src/backup/headless.ts).
 */

/** A folder on the phone that is backed up. */
export interface BackupSource {
  /** MediaStore relative path, e.g. "DCIM/Camera/". */
  path: string
  /** Only media added at or after this time (unix seconds). */
  since: number
  /** Where it goes in the drive (created on first use). */
  folderId?: string
}

export interface BackupSettings {
  enabled: boolean
  wifiOnly: boolean
  /** Before several folders existed: the camera's start time. */
  since: number
  /** The "Camera Backup" folder. */
  folderId?: string
  /** The drive photos go to (the one open when backup was turned on). */
  driveId?: string
  sources?: BackupSource[]
  /** Also back up while the app is closed. */
  background?: boolean
}

export const CAMERA_PATH = 'DCIM/Camera/'
export const SETTINGS_KEY = 'backup'
const DONE_KEY = 'backupDone'
const FOLDER_NAME = 'Camera Backup'
const BATCH = 1000

/** What the backup needs from whoever runs it (the app, or the background page). */
export interface BackupHost {
  /** Connected and the drive is loaded. */
  ready(): boolean
  drive(): Drive
  /** Name of a drive, for the "open that drive" message. */
  driveName(id: string): string | undefined
}

let host: BackupHost | null = null

export function setBackupHost(h: BackupHost): void {
  host = h
}

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

/** The folders being backed up (older settings: just the camera). */
export function sourcesOf(s: BackupSettings): BackupSource[] {
  return s.sources ?? [{ path: CAMERA_PATH, since: s.since }]
}

/** "DCIM/Screenshots/" → "Screenshots". */
export function folderLabel(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

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

export async function loadBackupSettings(): Promise<BackupSettings> {
  await load()
  return useBackup.getState().settings
}

export async function updateBackupSettings(changes: Partial<BackupSettings>): Promise<void> {
  await load()
  const settings = { ...useBackup.getState().settings, ...changes }
  // Turning backup on in another drive moves it there
  if (changes.enabled && settings.driveId !== currentDriveId()) {
    settings.driveId = currentDriveId() ?? undefined
    delete settings.folderId
    settings.sources = sourcesOf(settings).map(({ folderId: _, ...s }) => s)
  }
  useBackup.setState({ settings, status: settings.enabled ? 'Waiting…' : 'Off' })
  await setKV(SETTINGS_KEY, settings)
  await syncBackgroundSchedule()
  if (settings.enabled) void runBackup()
}

/** Start or stop backing up a folder. `since`: only media added from then on (0 = everything). */
export async function setSource(path: string, on: boolean, since = Math.floor(Date.now() / 1000)): Promise<void> {
  await load()
  const current = sourcesOf(useBackup.getState().settings)
  const sources = on
    ? [...current.filter((s) => s.path !== path), { path, since }]
    : current.filter((s) => s.path !== path)
  await updateBackupSettings({ sources })
}

/** Tell Android whether to back up while the app is closed. */
async function syncBackgroundSchedule() {
  if (!isAndroid || isHeadless) return
  const { enabled, background, wifiOnly } = useBackup.getState().settings
  await Native.scheduleBackgroundBackup({ enabled: enabled && !!background, wifiOnly }).catch((e) =>
    console.warn('Could not schedule background backup', e),
  )
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

async function network(): Promise<{ connected: boolean; wifi: boolean }> {
  if (isHeadless) return Native.network()
  const s = await Network.getStatus()
  return { connected: s.connected, wifi: s.connectionType === 'wifi' }
}

/** Look for new media in the chosen folders and queue uploads. Safe to call often. Returns how many were queued. */
export async function runBackup(): Promise<number> {
  await load()
  const { settings, running } = useBackup.getState()
  if (!isAndroid || !settings.enabled || running || !host?.ready()) return 0
  useBackup.setState({ running: true })
  try {
    if (!(await Native.mediaPermission({})).granted) {
      useBackup.setState({ status: 'Needs permission to read photos and videos' })
      return 0
    }
    // Backups belong to one drive; older settings (from before multiple drives) adopt the open one
    if (!settings.driveId) await updateSettingsQuietly({ driveId: currentDriveId() ?? undefined })
    else if (settings.driveId !== currentDriveId()) {
      const name = host.driveName(settings.driveId)
      useBackup.setState({ status: `Paused: open the “${name ?? 'backup'}” drive to back up` })
      return 0
    }
    if (!hasAccountKeys()) {
      useBackup.setState({ status: 'Waiting: enter your TeleDrive password in the app' })
      return 0
    }
    const sources = sourcesOf(useBackup.getState().settings)
    if (!sources.length) {
      useBackup.setState({ status: 'No folders chosen' })
      return 0
    }
    const net = await network()
    if (!net.connected) {
      useBackup.setState({ status: 'Waiting for internet' })
      return 0
    }
    if (settings.wifiOnly && !net.wifi) {
      useBackup.setState({ status: 'Waiting for Wi-Fi' })
      return 0
    }

    const rootId = await ensureRootFolder()
    const jobs: { item: CameraItem; folderId: string }[] = []
    for (const source of sources) {
      const items = await listNew(source)
      if (!items.length) continue
      const folderId = await ensureSourceFolder(source, rootId)
      for (const item of items) jobs.push({ item, folderId })
    }
    // The same photo can show up twice across batches with equal timestamps
    const unique = [...new Map(jobs.map((j) => [j.item.id, j])).values()]

    // Turned off while we were looking? Then don't start anything.
    if (!useBackup.getState().settings.enabled) return 0

    for (const { item, folderId } of unique) queue(item, folderId)
    useBackup.setState({
      status: unique.length ? `Backing up ${unique.length} item${unique.length > 1 ? 's' : ''}` : 'Up to date',
      lastCheck: Date.now(),
    })
    return unique.length
  } catch (e) {
    console.error('Camera backup failed', e)
    useBackup.setState({ status: `Error: ${e instanceof Error ? e.message : String(e)}` })
    return 0
  } finally {
    useBackup.setState({ running: false })
  }
}

/** New (not yet backed up or queued) media in one folder. */
async function listNew(source: BackupSource): Promise<CameraItem[]> {
  let since = source.since
  const out: CameraItem[] = []
  for (;;) {
    const { items } = await Native.listMedia({ paths: [source.path], since, limit: BATCH })
    // Safety net: the list must only contain items from `since` on, and each page must move forward
    if (items.some((i) => i.dateAdded < since)) throw new Error('Photo list returned items older than requested')
    out.push(...items.filter((i) => !done.has(i.id) && !queued.has(i.id)))
    if (items.length < BATCH) break
    const next = items[items.length - 1].dateAdded + 1
    if (next <= since) break
    since = next
  }
  return out
}

function queue(item: CameraItem, folderId: string) {
  queued.add(item.id)
  enqueue('upload', item.name, item.size, async (ctl) => {
    let failed = false
    try {
      const drive = host!.drive()
      await uploadFile(new PhoneFile(item), uniqueName(drive, folderId, item.name), folderId, ctl, { level: ROOT_LEVEL })
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

/** The "Camera Backup" folder: the saved one if it still exists, else one at the top level. */
async function ensureRootFolder(): Promise<string> {
  const drive = host!.drive()
  const { settings } = useBackup.getState()
  const saved = settings.folderId ? drive.items.get(settings.folderId) : undefined
  // Backups run unattended, so they can't go into a locked folder
  if (saved?.kind === 'folder' && saved.level !== ROOT_LEVEL)
    throw new Error('The Camera Backup folder is inside a locked folder. Move it out to keep backing up.')
  if (saved?.kind === 'folder' && !isHidden(drive, saved)) return saved.id
  const existing = listFolder(drive, ROOT).find((i) => i.kind === 'folder' && i.name === FOLDER_NAME)
  const folderId = existing?.id ?? (await createFolder(drive, ROOT, FOLDER_NAME))
  await updateSettingsQuietly({ folderId })
  return folderId
}

/** Where a source's media goes: the camera into Camera Backup itself, others into a subfolder. */
async function ensureSourceFolder(source: BackupSource, rootId: string): Promise<string> {
  if (source.path === CAMERA_PATH) return rootId
  const drive = host!.drive()
  const saved = source.folderId ? drive.items.get(source.folderId) : undefined
  if (saved?.kind === 'folder' && !isHidden(drive, saved)) return saved.id
  const name = folderLabel(source.path)
  const existing = listFolder(drive, rootId).find((i) => i.kind === 'folder' && i.name === name)
  const folderId = existing?.id ?? (await createFolder(drive, rootId, name))
  const sources = sourcesOf(useBackup.getState().settings).map((s) => (s.path === source.path ? { ...s, folderId } : s))
  await updateSettingsQuietly({ sources })
  return folderId
}

async function updateSettingsQuietly(changes: Partial<BackupSettings>) {
  const settings = { ...useBackup.getState().settings, ...changes }
  useBackup.setState({ settings })
  await setKV(SETTINGS_KEY, settings)
}

/** Resolves when nothing is uploading or waiting to upload. */
export function transfersIdle(): Promise<Transfer[]> {
  return new Promise((resolve) => {
    let unsubscribe: (() => void) | null = null
    let finished = false
    const check = (list: Transfer[]) => {
      if (finished || list.some((t) => ['queued', 'running', 'paused'].includes(t.status))) return
      finished = true
      queueMicrotask(() => unsubscribe?.())
      resolve(list)
    }
    unsubscribe = subscribeTransfers(check)
    if (finished) unsubscribe()
  })
}

/** One backup round, then wait for its uploads. Result for Android's background job (JSON). */
export async function backupRound(): Promise<string> {
  const before = useBackup.getState().backedUp
  await runBackup()
  const list = await transfersIdle()
  const failed = list.filter((t) => t.kind === 'upload' && t.status === 'error').length
  return JSON.stringify({ uploaded: useBackup.getState().backedUp - before, failed, status: useBackup.getState().status })
}

const AUTO_CHECK_GAP = 30_000
let lastAutoCheck = 0

/** Automatic checks are spaced out; "Back up now" calls runBackup() directly. */
function autoCheck() {
  if (Date.now() - lastAutoCheck < AUTO_CHECK_GAP) return
  lastAutoCheck = Date.now()
  void runBackup()
}

/** In the app: check for new photos when it opens, comes back to the foreground, or joins Wi-Fi. */
export function initCameraBackup(h: BackupHost): void {
  if (!isAndroid) return
  setBackupHost(h)
  void load().then(syncBackgroundSchedule)
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
  // Android's background job, while the app is still running in the background
  void Native.addListener('backgroundBackup', () => {
    backupRound().then(
      (result) => Native.backgroundBackupDone({ result }),
      (e) => Native.backgroundBackupDone({ result: JSON.stringify({ status: `Error: ${String(e)}` }) }),
    )
  })
}
