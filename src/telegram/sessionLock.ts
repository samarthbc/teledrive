/**
 * Only one browser tab may use the Telegram session at a time. Two tabs connecting with the same
 * login at once can make Telegram end the session (AUTH_KEY_DUPLICATED).
 *
 * Uses the Web Locks API; where it's missing (very old browsers), locking is skipped.
 */
const LOCK = 'teledrive-session'

let takenOver: (() => void) | null = null

/** Called when another tab takes over the session. */
export function onSessionTakenOver(fn: () => void): void {
  takenOver = fn
}

/** Try to become the tab that uses the session. With `takeOver`, grab it from another tab. */
export function acquireSessionLock(takeOver = false): Promise<boolean> {
  if (!('locks' in navigator)) return Promise.resolve(true)
  return new Promise((resolve) => {
    navigator.locks
      .request(LOCK, takeOver ? { steal: true } : { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(false)
          return
        }
        resolve(true)
        // Hold the lock for as long as this page is open
        return new Promise<void>(() => {})
      })
      .catch((e: Error) => {
        // Our lock was taken by a newer tab
        if (e.name === 'AbortError') takenOver?.()
      })
  })
}
