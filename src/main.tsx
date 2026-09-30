import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Hash routing works on static hosts (GitHub Pages) and inside the mobile app */}
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
