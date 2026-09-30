/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TG_API_ID?: string
  readonly VITE_TG_API_HASH?: string
}

// Use the global Buffer (injected by vite-plugin-node-polyfills). GramJS checks
// `instanceof Buffer` against this exact class, so never import 'buffer' directly.
declare const Buffer: typeof import('buffer').Buffer
