// The Windows desktop app (Electron, see electron/). Its preload script adds `teledriveDesktop`.

import type { UpdateState } from '../lib/updates'

interface DesktopBridge {
  setTheme(mode: 'system' | 'light' | 'dark'): void
  /** Automatic updates (electron/main.cjs): the current state, and every change. */
  updateState(): Promise<UpdateState>
  onUpdate(fn: (s: UpdateState) => void): () => void
  /** Quit, install the downloaded update and start again. */
  installUpdate(): void
}

export const desktop = (window as unknown as { teledriveDesktop?: DesktopBridge }).teledriveDesktop
export const isDesktop = !!desktop
