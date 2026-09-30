import { create } from 'zustand'

// "Install app" (PWA): the browser offers installing through a `beforeinstallprompt` event, which
// we keep until the user clicks the button.

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export const useInstall = create<{ event: InstallPromptEvent | null }>(() => ({ event: null }))

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault() // show our own button instead of the browser's mini bar
  useInstall.setState({ event: e as InstallPromptEvent })
})
window.addEventListener('appinstalled', () => useInstall.setState({ event: null }))

export async function installApp(): Promise<void> {
  const e = useInstall.getState().event
  if (!e) return
  await e.prompt()
  await e.userChoice
  useInstall.setState({ event: null })
}
