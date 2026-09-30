import { subscribeTransfers } from '../drive/queue'
import { formatBytes } from '../lib/format'
import { isAndroid, Native } from './android'

const UPDATE_EVERY = 2000
const ACTIVE = ['queued', 'running', 'paused']

/**
 * While anything is uploading or downloading, show an Android notification (foreground service)
 * so the system keeps the app running in the background.
 */
export function initKeepAlive(): void {
  if (!isAndroid) return
  let shown = false
  let lastUpdate = 0
  let askedPermission = false

  subscribeTransfers(async (transfers) => {
    const active = transfers.filter((t) => ACTIVE.includes(t.status))
    if (!active.length) {
      if (shown) {
        shown = false
        await Native.stopKeepAlive().catch(() => {})
      }
      return
    }
    if (shown && Date.now() - lastUpdate < UPDATE_EVERY) return
    lastUpdate = Date.now()

    if (!askedPermission) {
      askedPermission = true
      await Native.notificationPermission().catch(() => {})
    }

    const uploads = active.filter((t) => t.kind === 'upload').length
    const downloads = active.length - uploads
    const size = active.reduce((n, t) => n + t.size, 0)
    const done = active.reduce((n, t) => n + Math.min(t.done, t.size), 0)
    const title = [
      uploads && `Uploading ${uploads} file${uploads > 1 ? 's' : ''}`,
      downloads && `Downloading ${downloads} file${downloads > 1 ? 's' : ''}`,
    ]
      .filter(Boolean)
      .join(' · ')
    try {
      await Native.keepAlive({
        title,
        text: `${formatBytes(done)} of ${formatBytes(size)}`,
        progress: size ? Math.floor((done / size) * 100) : 0,
      })
      shown = true
    } catch (e) {
      // Android won't start it from the background; try again next update
      console.warn('Could not show transfer notification', e)
    }
  })
}
