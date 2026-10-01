// The Windows desktop app (Electron, see electron/). Its preload script adds `teledriveDesktop`.

interface DesktopBridge {
  setTheme(mode: 'system' | 'light' | 'dark'): void
}

export const desktop = (window as unknown as { teledriveDesktop?: DesktopBridge }).teledriveDesktop
export const isDesktop = !!desktop
