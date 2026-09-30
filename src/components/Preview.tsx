import { ChevronLeft, ChevronRight, Download, ExternalLink, Info, Loader2, TriangleAlert, X } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { readBlob, readHead } from '../drive/download'
import { isAndroid } from '../native/android'
import { useBackHandler } from '../native/backButton'
import { canStream, streamUrl } from '../drive/stream'
import { TransferControl } from '../drive/transfer'
import type { FileItem } from '../drive/tree'
import { fileIcon, formatBytes, previewKind, type PreviewKind } from '../lib/format'
import type { FrameKind } from '../viewer/frame'

// Loaded only when needed (pdf.js and the document renderers are large)
const PdfPreview = lazy(() => import('./previews/PdfPreview'))
const SandboxedPreview = lazy(() => import('./previews/SandboxedPreview'))
const ZipPreview = lazy(() => import('./previews/ZipPreview'))

/** Largest file loaded fully into memory for preview (images, PDFs, non-streamed media). */
const MAX_IN_MEMORY = 100 * 1024 * 1024
/** Office documents are parsed entirely in the browser; keep that reasonable on phones. */
const MAX_DOCUMENT = 50 * 1024 * 1024
const TEXT_PREVIEW_BYTES = 1024 * 1024
const FRAME_KINDS: PreviewKind[] = ['docx', 'pptx', 'sheet', 'markdown']
const DOCUMENT_KINDS: PreviewKind[] = [...FRAME_KINDS, 'pdf', 'zip']
/** Swiping between files only for media; documents need horizontal scrolling. */
const SWIPE_KINDS: PreviewKind[] = ['image', 'video', 'audio', 'none', 'unsupported-office']

// Keep a few recently viewed files so flipping back and forth is instant
const blobCache = new Map<string, string>()
function rememberUrl(id: string, url: string) {
  blobCache.set(id, url)
  while (blobCache.size > 6) {
    const [oldId, oldUrl] = blobCache.entries().next().value!
    URL.revokeObjectURL(oldUrl)
    blobCache.delete(oldId)
  }
}

interface Props {
  files: FileItem[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
  onDownload: (file: FileItem) => void
  onDetails: (file: FileItem) => void
  /** Android: open the file in another app (PDF viewer, etc.). */
  onOpenWith: (file: FileItem) => void
}

export default function Preview({ files, index, onIndex, onClose, onDownload, onDetails, onOpenWith }: Props) {
  const file = files[index]
  useBackHandler(true, onClose)
  const touchX = useRef<number | null>(null)
  const swipe = file ? SWIPE_KINDS.includes(previewKind(file)) : false
  const prev = index > 0 ? () => onIndex(index - 1) : undefined
  const next = index < files.length - 1 ? () => onIndex(index + 1) : undefined

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && !isMediaFocused()) prev?.()
      else if (e.key === 'ArrowRight' && !isMediaFocused()) next?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!file) return null

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black text-white"
      onTouchStart={(e) => (touchX.current = swipe ? e.touches[0].clientX : null)}
      onTouchEnd={(e) => {
        if (touchX.current === null) return
        const dx = e.changedTouches[0].clientX - touchX.current
        touchX.current = null
        if (dx > 60) prev?.()
        else if (dx < -60) next?.()
      }}
    >
      <header className="flex items-center gap-2 px-3 py-2 sm:px-4">
        <button className="preview-btn" onClick={onClose} aria-label="Close">
          <X className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{file.name}</p>
          <p className="text-xs text-white/50">
            {formatBytes(file.size)}
            {files.length > 1 && ` · ${index + 1} of ${files.length}`}
          </p>
        </div>
        {isAndroid && (
          <button className="preview-btn" onClick={() => onOpenWith(file)} aria-label="Open with" disabled={!file.complete}>
            <ExternalLink className="h-5 w-5" />
          </button>
        )}
        <button className="preview-btn" onClick={() => onDetails(file)} aria-label="Details">
          <Info className="h-5 w-5" />
        </button>
        <button className="preview-btn" onClick={() => onDownload(file)} aria-label="Download" disabled={!file.complete}>
          <Download className="h-5 w-5" />
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <Content key={file.id} file={file} onDownload={() => onDownload(file)} onOpenWith={() => onOpenWith(file)} />
        {prev && (
          <button className="preview-btn absolute left-2 hidden bg-black/40 sm:flex" onClick={prev} aria-label="Previous">
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        {next && (
          <button className="preview-btn absolute right-2 hidden bg-black/40 sm:flex" onClick={next} aria-label="Next">
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>
    </div>
  )
}

function isMediaFocused() {
  const tag = document.activeElement?.tagName
  return tag === 'VIDEO' || tag === 'AUDIO'
}

function Content({ file, onDownload, onOpenWith }: { file: FileItem; onDownload: () => void; onOpenWith: () => void }) {
  const kind = previewKind(file)
  const openWith = isAndroid ? onOpenWith : undefined
  if (!file.complete) return <Unavailable file={file} message="This file is incomplete (some parts are missing)." />
  if ((kind === 'video' || kind === 'audio') && canStream()) return <Media file={file} src={streamUrl(file)} kind={kind} />
  if (kind === 'text') return <TextPreview file={file} />
  if (kind === 'unsupported-office') {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    const modern = ['doc', 'dot'].includes(ext) ? '.docx' : ['ppt', 'pps', 'pot'].includes(ext) ? '.pptx' : null
    return (
      <Unavailable
        file={file}
        message={
          modern
            ? `Old .${ext} files can't be previewed. Save it as ${modern} to preview it here, or open it in another app.`
            : `.${ext} files can't be previewed here. Open it in another app or download it.`
        }
        onOpenWith={openWith}
        onDownload={onDownload}
      />
    )
  }
  if (kind === 'none') return <Unavailable file={file} message="No preview for this file type." onOpenWith={openWith} onDownload={onDownload} />
  if (DOCUMENT_KINDS.includes(kind)) {
    if (file.size > MAX_DOCUMENT)
      return <Unavailable file={file} message="This document is too large to preview." onOpenWith={openWith} onDownload={onDownload} />
    return <DocumentPreview file={file} kind={kind} onOpenWith={openWith} onDownload={onDownload} />
  }
  if (file.size > MAX_IN_MEMORY)
    return <Unavailable file={file} message="This file is too large to preview." onOpenWith={openWith} onDownload={onDownload} />
  return <InMemory file={file} kind={kind} onDownload={onDownload} />
}

/** Downloads the document into memory, then hands the bytes to the right viewer. */
function DocumentPreview(props: { file: FileItem; kind: PreviewKind; onOpenWith?: () => void; onDownload: () => void }) {
  const { file, kind, onOpenWith, onDownload } = props
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null)
  const [loaded, setLoaded] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const onError = useCallback((m: string) => setError(m), [])

  useEffect(() => {
    const ctl = new TransferControl((n) => setLoaded((l) => l + n))
    readBlob(file, ctl)
      .then((blob) => blob.arrayBuffer())
      .then(setBytes, (e) => !ctl.canceled && setError(e instanceof Error ? e.message : String(e)))
    return () => ctl.cancel()
  }, [file])

  if (error)
    return <Unavailable file={file} message={`Couldn't preview this file (${error}).`} onOpenWith={onOpenWith} onDownload={onDownload} />
  if (!bytes) return <Loading label={`Loading… ${Math.round((loaded / file.size) * 100)}%`} />
  return (
    <Suspense fallback={<Loading label="Opening…" />}>
      {kind === 'pdf' ? (
        <PdfPreview bytes={bytes} onError={onError} />
      ) : kind === 'zip' ? (
        <ZipPreview bytes={bytes} onError={onError} />
      ) : (
        <SandboxedPreview kind={kind as FrameKind} bytes={bytes} onError={onError} />
      )}
    </Suspense>
  )
}

/** Loads the whole file, then shows it (images, and media when streaming isn't available). */
function InMemory({ file, kind, onDownload }: { file: FileItem; kind: string; onDownload: () => void }) {
  const [url, setUrl] = useState<string | null>(blobCache.get(file.id) ?? null)
  const [loaded, setLoaded] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(false)

  useEffect(() => {
    if (url) return
    const ctl = new TransferControl((n) => setLoaded((l) => l + n))
    readBlob(file, ctl).then(
      (blob) => {
        const u = URL.createObjectURL(blob)
        rememberUrl(file.id, u)
        setUrl(u)
      },
      (e) => !ctl.canceled && setError(e instanceof Error ? e.message : String(e)),
    )
    return () => ctl.cancel()
  }, [file, url])

  if (error) return <Unavailable file={file} message={error} onDownload={onDownload} />
  if (!url) return <Loading label={`Loading… ${Math.round((loaded / file.size) * 100)}%`} />

  if (kind === 'image')
    return (
      <div className={`h-full w-full ${zoom ? 'overflow-auto' : 'flex items-center justify-center p-2 sm:p-8'}`}>
        <img
          src={url}
          alt={file.name}
          onClick={() => setZoom(!zoom)}
          onError={() => setError("Your browser can't display this image format.")}
          className={zoom ? 'max-w-none cursor-zoom-out' : 'max-h-full max-w-full cursor-zoom-in object-contain'}
        />
      </div>
    )
  return <Media file={file} src={url} kind={kind} />
}

function Media({ file, src, kind }: { file: FileItem; src: string; kind: string }) {
  const [error, setError] = useState(false)
  if (error) return <Unavailable file={file} message="Your browser can't play this format. Download it to play it in another app." />
  return kind === 'audio' ? (
    <div className="flex w-full max-w-md flex-col items-center gap-6 p-6">
      <Big file={file} />
      <audio src={src} controls autoPlay className="w-full" onError={() => setError(true)} />
    </div>
  ) : (
    <video src={src} controls autoPlay playsInline className="max-h-full max-w-full" onError={() => setError(true)} />
  )
}

function TextPreview({ file }: { file: FileItem }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    readHead(file, TEXT_PREVIEW_BYTES).then(
      (bytes) => setText(new TextDecoder().decode(bytes)),
      (e) => setError(e instanceof Error ? e.message : String(e)),
    )
  }, [file])
  if (error) return <Unavailable file={file} message={error} />
  if (text === null) return <Loading label="Loading…" />
  return (
    <div className="h-full w-full max-w-5xl overflow-auto p-2 sm:p-4">
      <pre className="min-h-full rounded-lg bg-slate-900 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-slate-100 sm:text-sm">
        {text}
        {file.size > TEXT_PREVIEW_BYTES && '\n\n… (showing the first 1 MB)'}
      </pre>
    </div>
  )
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 text-white/70">
      <Loader2 className="h-8 w-8 animate-spin" />
      <p className="text-sm">{label}</p>
    </div>
  )
}

function Big({ file }: { file: FileItem }) {
  const { Icon, color } = fileIcon(file)
  return <Icon className={`h-20 w-20 ${color}`} strokeWidth={1} />
}

function Unavailable(props: { file: FileItem; message: string; onDownload?: () => void; onOpenWith?: () => void }) {
  const { file, message, onDownload, onOpenWith } = props
  return (
    <div className="flex max-w-sm flex-col items-center gap-4 p-6 text-center">
      {message.includes('incomplete') ? <TriangleAlert className="h-12 w-12 text-amber-400" /> : <Big file={file} />}
      <p className="text-sm text-white/70">{message}</p>
      {onOpenWith && (
        <button className="btn-primary" onClick={onOpenWith}>
          <ExternalLink className="h-4 w-4" /> Open with…
        </button>
      )}
      {onDownload && (
        <button className={onOpenWith ? 'btn-ghost text-white/80 hover:bg-white/10' : 'btn-primary'} onClick={onDownload}>
          <Download className="h-4 w-4" /> Download ({formatBytes(file.size)})
        </button>
      )}
    </div>
  )
}
