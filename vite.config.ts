/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // GramJS expects Node built-ins (Buffer, crypto, os, ...)
    nodePolyfills({ globals: { Buffer: true, process: true, global: true }, exclude: ['vm'] }),
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
})
