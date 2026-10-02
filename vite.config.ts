/// <reference types="vitest/config" />
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { inlineScript } from './src/viewer/inline'

const pkg = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8')) as { version: string }

// Build modes (IMPLEMENTATION.md Phase 9):
// - default (`npm run dev`, `npm run build`): your own builds, API keys from .env built in
// - 'release': the public Windows and Android apps, no keys (each person enters theirs on Setup)
// - 'website': the public website, no keys, plus a Content-Security-Policy
const PUBLIC_MODES = ['release', 'website']

export default defineConfig(({ mode }) => ({
  // Public builds read no VITE_* variables, so the keys in .env can't end up in them
  envPrefix: PUBLIC_MODES.includes(mode) ? 'TELEDRIVE_PUBLIC_' : 'VITE_',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    tailwindcss(),
    // GramJS expects Node built-ins (Buffer, crypto, os, ...)
    nodePolyfills({ globals: { Buffer: true, process: true, global: true }, exclude: ['vm'] }),
    mode === 'website' && contentSecurityPolicy(),
  ],
  build: {
    // GramJS (the Telegram library) alone is ~1.5 MB
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        // Camera backup while the Android app is closed (see src/backup/headless.ts)
        backup: fileURLToPath(new URL('backup.html', import.meta.url)),
      },
    },
  },
  test: {
    environment: 'node',
  },
}))

/**
 * The website's Content-Security-Policy, as a <meta> tag so it can carry the hash of the document
 * viewer's inline script (src/viewer/generated/frame.js, rebuilt with the app). A sandboxed srcdoc
 * frame inherits this policy, so that one script must be allowed by hash. vercel.json adds the
 * parts a <meta> can't set (frame-ancestors).
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'teledrive-csp',
    transformIndexHtml() {
      const frame = readFileSync(new URL('src/viewer/generated/frame.js', import.meta.url), 'utf8')
      const hash = createHash('sha256').update(inlineScript(frame)).digest('base64')
      const policy = [
        "default-src 'self'",
        // hash-wasm and pdf.js use WebAssembly
        `script-src 'self' 'wasm-unsafe-eval' 'sha256-${hash}'`,
        // Document previews (docx, pptx) add <style> elements inside their sandboxed frame
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "font-src 'self' data: blob:",
        // Telegram (WebSockets), and GitHub for the latest app version
        "connect-src 'self' wss://*.web.telegram.org https://*.web.telegram.org https://api.github.com blob: data:",
        "worker-src 'self' blob:",
        "frame-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ')
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }]
    },
  }
}
