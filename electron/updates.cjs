// Automatic updates for the Windows app (IMPLEMENTATION.md Phase 9), from the project's GitHub Releases.
//
// A while after start (and every few hours) the app asks GitHub for the latest release. If it's newer, the
// installer is downloaded in the background into the app's data folder and checked against the size and
// SHA-256 GitHub reports. It's installed silently when the app closes, or right away with "Restart to update"
// (the installer then starts the app again). Logins and files are kept: they live in %APPDATA%\TeleDrive.

const { app, net } = require('electron')
const { spawn } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const REPO = 'samarthbc/teledrive'
const FILE = 'TeleDrive-Setup.exe'
const FIRST_CHECK = 15_000
const CHECK_EVERY = 6 * 60 * 60 * 1000
// For testing the updater on this PC only: a local stand-in for GitHub (http://127.0.0.1:<port>)
const TEST_FEED = /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.TELEDRIVE_UPDATE_FEED || '') ? process.env.TELEDRIVE_UPDATE_FEED : null
const API = TEST_FEED ? `${TEST_FEED}/latest` : `https://api.github.com/repos/${REPO}/releases/latest`
const assetUrl = (version) => (TEST_FEED ? `${TEST_FEED}/${FILE}` : `https://github.com/${REPO}/releases/download/v${version}/${FILE}`)

const DIR = path.join(app.getPath('userData'), 'updates')

let state = { status: 'none', version: null, progress: 0, error: null }
let installer = null
let installing = false
let onChange = () => {}

function set(changes) {
  state = { ...state, ...changes }
  onChange(state)
}

function isNewer(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d > 0
  }
  return false
}

// The app's own https handler (main.cjs) is skipped: these requests go straight to GitHub
const get = (url, init = {}) => net.fetch(url, { ...init, bypassCustomProtocolHandlers: true })

async function check() {
  if (state.status === 'downloading' || state.status === 'ready') return
  try {
    const res = await get(API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'TeleDrive' } })
    if (!res.ok) return // no release yet, rate limit or offline: try again later
    const release = await res.json()
    const version = String(release.tag_name || '').replace(/^v/, '')
    if (!/^\d+\.\d+\.\d+$/.test(version) || !isNewer(version, app.getVersion())) return
    const asset = (release.assets || []).find((a) => a.name === FILE)
    if (!asset) return
    const sha256 = typeof asset.digest === 'string' && asset.digest.startsWith('sha256:') ? asset.digest.slice(7).toLowerCase() : null
    await download(version, asset.size, sha256)
  } catch (e) {
    set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
  }
}

async function download(version, size, sha256) {
  fs.mkdirSync(DIR, { recursive: true })
  const file = path.join(DIR, `TeleDrive-Setup-${version}.exe`)
  // Downloaded before (e.g. the app was closed before installing it)
  if (fs.existsSync(file) && (await verify(file, size, sha256))) return ready(version, file)

  set({ status: 'downloading', version, progress: 0, error: null })
  const res = await get(assetUrl(version))
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`)
  const part = file + '.part'
  const out = fs.createWriteStream(part)
  const reader = res.body.getReader()
  let done = 0
  try {
    for (;;) {
      const { value, done: end } = await reader.read()
      if (end) break
      if (!out.write(value)) await new Promise((r) => out.once('drain', r))
      done += value.length
      const progress = size ? Math.min(100, Math.floor((done * 100) / size)) : -1
      if (progress !== state.progress) set({ progress })
    }
  } finally {
    await new Promise((r) => out.end(r))
  }
  if (!(await verify(part, size, sha256))) {
    fs.rmSync(part, { force: true })
    throw new Error('The downloaded update was damaged')
  }
  fs.renameSync(part, file)
  ready(version, file)
}

async function verify(file, size, sha256) {
  if (fs.statSync(file).size !== size) return false
  if (!sha256) return true
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex') === sha256
}

function ready(version, file) {
  installer = file
  set({ status: 'ready', version, progress: 100, error: null })
}

/** Run the downloaded installer silently; with `restart`, it starts TeleDrive again when it's done. */
function runInstaller(restart) {
  if (!installer || installing) return false
  installing = true
  const args = ['/S', '--updated', ...(restart ? ['--force-run'] : [])]
  spawn(installer, args, { detached: true, stdio: 'ignore' }).unref()
  return true
}

/** Remove installers of versions that are already installed (or older). */
function cleanUp() {
  try {
    for (const name of fs.readdirSync(DIR)) {
      const v = /^TeleDrive-Setup-(\d+\.\d+\.\d+)\.exe(\.part)?$/.exec(name)?.[1]
      if (v && !isNewer(v, app.getVersion())) fs.rmSync(path.join(DIR, name), { force: true })
    }
  } catch {
    // No updates folder yet
  }
}

/** Start checking. `notify` receives every state change (sent to the page). */
function initUpdates(notify) {
  onChange = notify
  // Only the installed app updates itself (not `npm run desktop`)
  if (!app.isPackaged) return
  cleanUp()
  setTimeout(() => void check(), FIRST_CHECK)
  setInterval(() => void check(), CHECK_EVERY)
  // Closing the app installs a downloaded update
  app.on('before-quit', () => {
    if (state.status === 'ready') runInstaller(false)
  })
}

/** "Restart to update". */
function installNow() {
  if (runInstaller(true)) app.quit()
}

module.exports = { initUpdates, installNow, getState: () => state }
