import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import '../lib/theme'
import { getKV, KEYS, openDriveDb, driveDb } from '../db/db'
import type { AccountConfig } from '../drive/crypto'
import { loadCache } from '../drive/sync'
import { restoreDeviceKeys } from '../drive/vault'
import { isVaultDrive, type DriveInfo } from '../telegram/channel'
import { matchingLogins } from '../vault/match'
import AutofillApp, { type FillRequest } from './AutofillApp'
import { parseKinds } from './fill'

// The autofill window's page (autofill.html), loaded by AutofillActivity.java from the app's own origin, so it shares
// the app's IndexedDB: the remembered TeleDrive password and TeleWarden's messages as last synced. It never connects
// to Telegram (the app may be using the session in the background).

const params = new URLSearchParams(location.search)
const request: FillRequest = {
  target: params.get('kind') === 'app' ? { app: params.get('target') ?? '' } : { web: params.get('target') ?? '' },
  appName: params.get('label') ?? undefined,
  fields: parseKinds(params.get('fields')),
}

async function load(): Promise<string | null> {
  // Development: the sample vault, locked (master password in dev/vaultMock.ts)
  if (import.meta.env.DEV && params.has('mock')) {
    await (await import('../dev/vaultMock')).startVaultMock('locked')
    return null
  }
  const drives = (await getKV<DriveInfo[]>(KEYS.drives)) ?? []
  const vault = drives.find(isVaultDrive)
  if (!vault) return 'TeleWarden isn’t set up yet. Open TeleDrive → TeleWarden to set it up.'
  await openDriveDb(vault.id)
  const cfg = (await driveDb().records.toArray()).filter((r) => r.meta.t === 'cfg').sort((a, b) => a.msgId - b.msgId)[0]
  const account = cfg?.meta.t === 'cfg' ? ((cfg.meta.e as AccountConfig | undefined) ?? null) : null
  // The TeleDrive password as remembered on this phone (it isn't when "Lock when TeleDrive closes" is on)
  if (!(await restoreDeviceKeys(account))) return 'Open TeleDrive and enter your TeleDrive password first, then try again.'
  await loadCache()
  return null
}

void load()
  .catch((e) => `Couldn’t open TeleWarden: ${e instanceof Error ? e.message : String(e)}`)
  .then((problem) => {
    // Handy while testing in a browser
    if (import.meta.env.DEV) Object.assign(window, { __autofill: { request, matchingLogins } })
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <AutofillApp request={request} problem={problem} />
      </StrictMode>,
    )
  })
