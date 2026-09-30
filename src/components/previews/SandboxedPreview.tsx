import { useEffect, useRef, useState } from 'react'
import type { FrameKind, RenderMessage } from '../../viewer/frame'

/**
 * Shows a document rendered by src/viewer/frame.ts inside a sandboxed iframe:
 * - `sandbox="allow-scripts"` without `allow-same-origin` → opaque origin, so the frame can't read
 *   the app's IndexedDB (Telegram session) or touch the parent page
 * - CSP `default-src 'none'` → the frame can't make network requests (no tracking pixels, no leaks)
 */

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data: blob:',
].join('; ')

let frameCode: Promise<string> | null = null
const loadFrameCode = () => (frameCode ??= import('../../viewer/generated/frame.js?raw').then((m) => m.default))

function srcDoc(code: string) {
  // The script is inlined, so "</script" inside it must not end the tag early
  const safe = code.replace(/<\/script/gi, '<\\/script')
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
</head><body><div id="root"></div><script>${safe}</script></body></html>`
}

export default function SandboxedPreview(props: {
  kind: FrameKind
  bytes: ArrayBuffer
  onError: (message: string) => void
}) {
  const { kind, bytes, onError } = props
  const frame = useRef<HTMLIFrameElement>(null)
  const [doc, setDoc] = useState<string | null>(null)
  const [rendered, setRendered] = useState(false)

  useEffect(() => {
    loadFrameCode().then((code) => setDoc(srcDoc(code)), (e) => onError(String(e)))
  }, [onError])

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return
      const msg = e.data as { type: string; message?: string; url?: string }
      if (msg.type === 'ready') {
        const dark = document.documentElement.classList.contains('dark') || matchMedia('(prefers-color-scheme: dark)').matches
        const width = frame.current.clientWidth || window.innerWidth
        const render: RenderMessage = { type: 'render', kind, bytes: bytes.slice(0), dark, width }
        // Opaque-origin frames can only be addressed with '*'; the frame's content is our own srcdoc
        frame.current.contentWindow!.postMessage(render, '*', [render.bytes])
      } else if (msg.type === 'rendered') setRendered(true)
      else if (msg.type === 'error') onError(msg.message ?? 'Could not show this file')
      else if (msg.type === 'open-link' && msg.url && /^https?:\/\//i.test(msg.url)) {
        window.open(msg.url, '_blank', 'noopener,noreferrer')
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [kind, bytes, onError])

  return (
    <div className="relative h-full w-full">
      {doc && (
        <iframe
          ref={frame}
          title="Document preview"
          sandbox="allow-scripts"
          srcDoc={doc}
          className={`h-full w-full border-0 transition-opacity ${rendered ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      {!rendered && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-white/60">Rendering…</div>
      )}
    </div>
  )
}
