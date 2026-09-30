/// <reference types="vitest/config" />
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
  },
  test: {
    environment: 'node',
  },
})
