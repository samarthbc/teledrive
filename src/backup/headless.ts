// Camera backup while the app is closed. Android loads this page (backup.html) in a hidden WebView
// (HeadlessRunner.java) from the app's own origin, so it shares the app's IndexedDB: login, file
// index, backup settings. It backs up new photos, waits for the uploads, reports, and is destroyed.
// It never changes the login: if anything is off, it just stops and the app deals with it later.

import { loadKeys } from '../config'
import { getKV, KEYS, openDriveDb } from '../db/db'
import { onKeysChanged } from '../drive/keyring'
import { keyView, resolveSecrets, unresolved } from '../drive/secrets'
import { loadCache, subscribe, sync } from '../drive/sync'
import { buildDrive, type Drive, type MessageRecord } from '../drive/tree'
import { restoreDeviceKeys } from '../drive/vault'
import { backupRound, loadBackupSettings, setBackupHost } from '../native/backup'
import { isHeadless, Native } from '../native/android'
import { openStorage, type DriveInfo } from '../telegram/channel'
import { getClient, isAuthorized, resetClient } from '../telegram/client'
import { acquireSessionLock } from '../telegram/sessionLock'

const log = (message: string) => void Native.log({ message }).catch(() => {})

async function run(): Promise<object> {
  // The app (or another background run) is using the session
  if (!(await acquireSessionLock())) return { status: 'Skipped: the app is open' }

  const settings = await loadBackupSettings()
  if (!settings.enabled || !settings.background) return { status: 'Background backup is off' }
  if (!(await loadKeys()) || !(await getKV<string>(KEYS.session))) return { status: 'Not logged in' }

  const drives = (await getKV<DriveInfo[]>(KEYS.drives)) ?? []
  const target = drives.find((d) => d.id === settings.driveId)
  if (!target) return { status: 'Backup drive not found; open the app' }

  await getClient()
  if (!(await isAuthorized())) return { status: 'Logged out; open the app' }

  // Same drive, same data as the app
  await openDriveDb(target.id)
  openStorage(target)
  let records: Map<number, MessageRecord> = new Map()
  let drive: Drive = buildDrive([])
  const rebuild = async () => {
    const todo = unresolved(records.values())
    if (todo.length) await resolveSecrets(todo)
    drive = buildDrive(records.values(), keyView)
  }
  subscribe((r) => {
    records = r
    void rebuild()
  })
  onKeysChanged(() => void rebuild())
  await loadCache()
  await sync()
  // The TeleDrive password, as remembered on this phone
  if (!(await restoreDeviceKeys(drive.encryption ?? null))) return { status: 'Open the app and enter your TeleDrive password' }
  await rebuild()

  setBackupHost({ ready: () => true, drive: () => drive, driveName: () => undefined })
  return JSON.parse(await backupRound())
}

if (isHeadless) {
  run()
    .catch((e) => ({ status: `Error: ${e instanceof Error ? e.message : String(e)}` }))
    .then(async (result) => {
      log(`Background backup: ${JSON.stringify(result)}`)
      // Disconnect cleanly before the WebView is destroyed
      await resetClient().catch(() => {})
      await Native.done({ result: JSON.stringify(result) })
    })
}
