import { App } from '@capacitor/app'
import { create } from 'zustand'
import { isAndroid, isHeadless, Native } from '../native/android'
import { desktop } from '../native/desktop'
import { APP_VERSION, DOWNLOADS, isNewer, latestRelease } from './releases'

// Updating the apps from GitHub Releases (IMPLEMENTATION.md Phase 9), without reinstalling:
// - Windows: the desktop shell (electron/main.cjs) downloads a newer installer in the background and
//   installs it when the app closes; "Restart to update" does it now. This module only shows its state.
// - Android: "Update" downloads the APK (size and SHA-256 checked) and opens Android's installer; the new
//   version installs over the old one because both are signed with the same key. Data stays.

export type UpdateStatus = 'none' | 'available' | 'downloading' | 'ready' | 'needsPermission' | 'error'

export interface UpdateState {
  status: UpdateStatus
  version: string | null
  /** 0-100 while downloading (-1 if unknown). */
  progress: number
  error: string | null
}

export const useUpdate = create<UpdateState>(() => ({ status: 'none', version: null, progress: 0, error: null }))

export function initUpdates(): void {
  if (desktop) {
    void desktop.updateState().then((s) => useUpdate.setState(s))
    desktop.onUpdate((s) => useUpdate.setState(s))
    return
  }
  if (!isAndroid || isHeadless) return
  // A downloaded APK is no longer needed once this app starts (installed, or outdated)
  void Native.clearUpdate().catch(() => {})
  void latestRelease().then((r) => {
    if (r && isNewer(r.version, APP_VERSION) && r.sizes[DOWNLOADS.android.file]) useUpdate.setState({ status: 'available', version: r.version })
  })
  // Back from allowing "Install unknown apps": continue with the install
  void App.addListener('resume', () => {
    if (useUpdate.getState().status === 'needsPermission') void install()
  })
}

/** The Update button: Windows restarts into the downloaded update; Android downloads (if needed) and installs. */
export async function updateNow(): Promise<void> {
  if (desktop) return desktop.installUpdate()
  const { status, version } = useUpdate.getState()
  if (!isAndroid || !version || status === 'downloading') return
  if (status === 'ready' || status === 'needsPermission') return install()

  const release = await latestRelease()
  const file = DOWNLOADS.android.file
  if (!release || release.version !== version) return
  useUpdate.setState({ status: 'downloading', progress: 0, error: null })
  const listener = await Native.addListener('updateProgress', (e) => useUpdate.setState({ progress: e.progress }))
  try {
    await Native.downloadUpdate({ version, size: release.sizes[file] ?? 0, sha256: release.sha256?.[file] })
    useUpdate.setState({ status: 'ready' })
    await install()
  } catch (e) {
    useUpdate.setState({ status: 'error', error: e instanceof Error ? e.message : String(e) })
  } finally {
    void listener.remove()
  }
}

async function install() {
  try {
    const { needsPermission } = await Native.installUpdate()
    useUpdate.setState({ status: needsPermission ? 'needsPermission' : 'ready' })
  } catch (e) {
    useUpdate.setState({ status: 'error', error: e instanceof Error ? e.message : String(e) })
  }
}
