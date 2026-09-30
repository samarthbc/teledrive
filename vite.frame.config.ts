import { defineConfig } from 'vite'

// Builds src/viewer/frame.ts into one self-contained script. The app embeds it into a sandboxed
// iframe (srcdoc), which can't load other files, so everything must be in a single file.
export default defineConfig({
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    lib: { entry: 'src/viewer/frame.ts', formats: ['iife'], name: 'TeleDriveFrame', fileName: () => 'frame.js' },
    outDir: 'src/viewer/generated',
    emptyOutDir: true,
    copyPublicDir: false,
    chunkSizeWarningLimit: 4000,
  },
})
