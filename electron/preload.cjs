// The little the page needs from the desktop app; nothing else from Electron or Node is exposed.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('teledriveDesktop', {
  /** Match the window's title bar to the app's theme choice. */
  setTheme: (mode) => ipcRenderer.send('td-theme', mode),
})
