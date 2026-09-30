import { App } from '@capacitor/app'
import { useEffect, useRef } from 'react'
import { isAndroid } from './android'

/**
 * Android back button: the most recently opened thing that registered a handler closes first
 * (preview, dialog, menu, selection…). With nothing open, go back in history, else leave the app.
 */
const handlers: { fn: () => void }[] = []

export function initBackButton(): void {
  if (!isAndroid) return
  void App.addListener('backButton', ({ canGoBack }) => {
    const top = handlers.at(-1)
    if (top) top.fn()
    else if (canGoBack && location.hash && location.hash !== '#/') history.back()
    else void App.minimizeApp()
  })
}

/** While `active`, the back button calls `onBack` instead of navigating. */
export function useBackHandler(active: boolean, onBack: () => void): void {
  const latest = useRef(onBack)
  latest.current = onBack
  useEffect(() => {
    if (!active) return
    const entry = { fn: () => latest.current() }
    handlers.push(entry)
    return () => {
      const i = handlers.indexOf(entry)
      if (i >= 0) handlers.splice(i, 1)
    }
  }, [active])
}
