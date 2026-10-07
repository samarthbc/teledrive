import { getSettings } from '../lib/settings'
import { toast, toastError } from '../store/useToast'

// Copying secrets (IMPLEMENTATION.md → "Phase 19.5"): the clipboard is cleared after the time chosen in Settings.
// A web page can only write the clipboard while it has focus, so clearing waits for focus if needed.

let timer: ReturnType<typeof setTimeout> | undefined
let pendingFocus: (() => void) | null = null

async function write(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Older WebViews: the selection trick
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    if (!ok) throw new Error('Copying isn’t allowed here')
  }
}

/** Copy a secret and clear it from the clipboard later. */
export async function copySecret(text: string, label: string): Promise<void> {
  try {
    await write(text)
  } catch (e) {
    toastError(e)
    return
  }
  clearTimeout(timer)
  if (pendingFocus) window.removeEventListener('focus', pendingFocus)
  pendingFocus = null
  const seconds = getSettings().clipboardSeconds
  if (!seconds) return toast(`${label} copied`)
  toast(`${label} copied · clears in ${seconds} s`)
  timer = setTimeout(() => {
    const clear = () => {
      pendingFocus = null
      write('').then(() => toast('Clipboard cleared'), () => {})
    }
    if (document.hasFocus()) clear()
    else {
      pendingFocus = clear
      window.addEventListener('focus', clear, { once: true })
    }
  }, seconds * 1000)
}
