import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { initBackButton } from './native/backButton'
import { initKeepAlive } from './native/keepAlive'
import { initShareReceiver } from './native/share'
import { initAutoLock } from './drive/keyring'

// Android app features (no-ops on the website)
initBackButton()
initKeepAlive()
initShareReceiver()
// Unlocked files/folders lock again after a few idle minutes
initAutoLock()

// Troubleshooting hook, off unless localStorage 'td-debug' is '1' on this device
if (localStorage.getItem('td-debug') === '1') {
  void Promise.all([import('telegram'), import('./telegram/client'), import('./drive/transfer')]).then(([tg, c, t]) =>
    Object.assign(window, { __td: { Api: tg.Api, Buffer, getClient: c.getClient, randomLong: t.randomLong } }),
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Hash routing works on static hosts (GitHub Pages) and inside the mobile app */}
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
