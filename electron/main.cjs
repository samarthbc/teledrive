// TeleDrive desktop app (Windows): the same web build in its own window, served from the app's own
// files, so no server needs to run. See IMPLEMENTATION.md Phase 8.

const { app, BrowserWindow, Menu, ipcMain, nativeTheme, net, protocol, screen, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const updates = require('./updates.cjs')

// The app answers https://teledrive.invalid itself; nothing goes to the network (.invalid is a
// reserved name that never exists online). A fixed origin keeps the login session and drive cache
// between launches. It must be http(s): Chromium only streams video in pieces (Range requests,
// answered by public/sw.js) on http(s) addresses; on a custom app:// scheme it took the first 2 MB
// piece for the whole file, so videos over 2 MB failed to play.
const HOST = 'teledrive.invalid'
const ORIGIN = `https://${HOST}`
const DIST = path.join(__dirname, '..', 'dist')
const STATE_FILE = path.join(app.getPath('userData'), 'window.json')
const BACKGROUND = { light: '#e6e6e3', dark: '#1f2023' }

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
}

// One window: a second launch focuses the open one (the drive allows one open copy anyway)
if (!app.requestSingleInstanceLock()) app.quit()

let win = null

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

app.whenReady().then(() => {
  // Every other https request goes out as usual (Telegram itself uses WebSockets, not this)
  protocol.handle('https', (request) =>
    new URL(request.url).host === HOST ? serve(request) : net.fetch(request, { bypassCustomProtocolHandlers: true }))
  Menu.setApplicationMenu(null)
  // The renderer reports the theme choice so the title bar matches it (System / Light / Dark)
  ipcMain.on('td-theme', (_e, mode) => {
    if (mode !== 'system' && mode !== 'light' && mode !== 'dark') return
    nativeTheme.themeSource = mode
    win?.setBackgroundColor(BACKGROUND[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'])
  })
  createWindow()
  // Updates: the page shows the state in the side menu and can ask to restart into the update
  ipcMain.handle('td-update-state', () => updates.getState())
  ipcMain.on('td-update-install', () => updates.installNow())
  ipcMain.handle('td-update-check', () => updates.checkNow())
  ipcMain.on('td-protect', (_e, on) => win?.setContentProtection(!!on))
  updates.initUpdates((state) => win?.webContents.send('td-update', state))
})

app.on('window-all-closed', () => app.quit())

async function serve(request) {
  const url = new URL(request.url)
  const rel = decodeURIComponent(url.pathname)
  const file = path.normalize(path.join(DIST, rel === '/' ? 'index.html' : rel))
  // Nothing outside the build folder
  if (!file.startsWith(DIST + path.sep)) return new Response('Not found', { status: 404 })
  try {
    const body = await fs.promises.readFile(file)
    const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
    return new Response(body, { headers: { 'Content-Type': type, 'Cache-Control': 'no-cache' } })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

function createWindow() {
  const state = loadState()
  win = new BrowserWindow({
    ...state.bounds,
    minWidth: 360,
    minHeight: 520,
    title: 'TeleDrive',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: BACKGROUND[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'],
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  if (state.maximized) win.maximize()
  win.once('ready-to-show', () => win.show())

  // Links to other sites open in the normal browser; the app window never leaves the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(ORIGIN + '/')) return
    e.preventDefault()
    if (/^https?:/.test(url)) shell.openExternal(url)
  })
  // F12 / Ctrl+Shift+I: developer tools (troubleshooting); Ctrl+R / F5: reload
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    const key = input.key.toLowerCase()
    if (key === 'f12' || (input.control && input.shift && key === 'i')) win.webContents.toggleDevTools()
    else if (key === 'f5' || (input.control && key === 'r')) win.webContents.reload()
    else return
    e.preventDefault()
  })

  win.on('close', () => saveState())
  win.on('closed', () => (win = null))
  win.loadURL(`${ORIGIN}/index.html`)
}

function loadState() {
  const fallback = { bounds: { width: 1280, height: 820 }, maximized: false }
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    const b = s.bounds
    // Only reuse the position if it's still on a connected screen
    const visible = screen.getAllDisplays().some(({ workArea: a }) =>
      b.x >= a.x - 50 && b.y >= a.y - 50 && b.x + 200 <= a.x + a.width && b.y + 100 <= a.y + a.height)
    return { bounds: visible ? b : { width: b.width, height: b.height }, maximized: !!s.maximized }
  } catch {
    return fallback
  }
}

function saveState() {
  if (!win) return
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ bounds: win.getNormalBounds(), maximized: win.isMaximized() }))
  } catch {
    // Not worth failing a close over
  }
}

