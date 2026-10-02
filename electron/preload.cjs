// The little the page needs from the desktop app; nothing else from Electron or Node is exposed.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('teledriveDesktop', {
  /** Match the window's title bar to the app's theme choice. */
  setTheme: (mode) => ipcRenderer.send('td-theme', mode),
  /** Automatic updates: the current state, every change, and "restart to update". */
  updateState: () => ipcRenderer.invoke('td-update-state'),
  onUpdate: (fn) => {
    const listener = (_e, state) => fn(state)
    ipcRenderer.on('td-update', listener)
    return () => ipcRenderer.removeListener('td-update', listener)
  },
  installUpdate: () => ipcRenderer.send('td-update-install'),
})
