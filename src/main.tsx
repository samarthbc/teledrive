import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { initBackButton } from './native/backButton'
import { initKeepAlive } from './native/keepAlive'
import { initShareReceiver } from './native/share'

// Android app features (no-ops on the website)
initBackButton()
initKeepAlive()
initShareReceiver()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Hash routing works on static hosts (GitHub Pages) and inside the mobile app */}
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
