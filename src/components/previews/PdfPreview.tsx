import { Minus, Plus } from 'lucide-react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useEffect, useRef, useState } from 'react'

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]

async function openPdf(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  // pdf.js moves the buffer to its worker (the original becomes empty), so give it a copy:
  // the viewer can open the same bytes again (re-render, React dev mode running effects twice)
  const data = new Uint8Array(bytes.slice(0))
  // No eval (defense against malicious PDFs), no XFA forms
  return pdfjs.getDocument({ data, isEvalSupported: false, enableXfa: false }).promise
}

/** PDF viewer: pages are drawn onto canvases (pdf.js), only when scrolled into view. */
export default function PdfPreview({ bytes, onError }: { bytes: ArrayBuffer; onError: (m: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [ratio, setRatio] = useState(1.414) // height / width of page 1
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(0)
  const [current, setCurrent] = useState(1)

  useEffect(() => {
    let doc: PDFDocumentProxy | null = null
    openPdf(bytes).then(
      async (d) => {
        doc = d
        const vp = (await d.getPage(1)).getViewport({ scale: 1 })
        setRatio(vp.height / vp.width)
        setPdf(d)
      },
      (e) => onError(e instanceof Error ? e.message : String(e)),
    )
    return () => void doc?.destroy()
  }, [bytes, onError])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = () => setWidth(Math.min(el.clientWidth - 16, 1000))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pageWidth = Math.round(width * zoom)
  const onScroll = () => {
    const el = scroller.current
    if (!el || !pdf) return
    const pageH = pageWidth * ratio + 12
    setCurrent(Math.min(pdf.numPages, Math.floor((el.scrollTop + el.clientHeight / 3) / pageH) + 1))
  }

  return (
    <div className="relative h-full w-full">
      <div ref={scroller} onScroll={onScroll} className="h-full w-full overflow-auto py-2">
        {pdf &&
          pageWidth > 0 &&
          Array.from({ length: pdf.numPages }, (_, i) => (
            <PdfPage key={`${i}-${pageWidth}`} pdf={pdf} n={i + 1} width={pageWidth} ratio={ratio} root={scroller} />
          ))}
      </div>
      {pdf && (
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-sm text-white">
          <button className="preview-btn h-8 w-8" onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])} aria-label="Zoom out">
            <Minus className="h-4 w-4" />
          </button>
          <span className="min-w-20 text-center tabular-nums">
            {current} / {pdf.numPages}
          </span>
          <button className="preview-btn h-8 w-8" onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])} aria-label="Zoom in">
            <Plus className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}

function PdfPage(props: { pdf: PDFDocumentProxy; n: number; width: number; ratio: number; root: React.RefObject<HTMLDivElement | null> }) {
  const { pdf, n, width, ratio, root } = props
  const holder = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [height, setHeight] = useState(Math.round(width * ratio))

  useEffect(() => {
    const el = holder.current
    if (!el) return
    let task: { cancel: () => void } | null = null
    let done = false
    const observer = new IntersectionObserver(
      async ([entry]) => {
        if (!entry.isIntersecting || done) return
        done = true
        observer.disconnect()
        const page = await pdf.getPage(n)
        const base = page.getViewport({ scale: 1 })
        const dpr = Math.min(window.devicePixelRatio || 1, 3)
        const viewport = page.getViewport({ scale: (width / base.width) * dpr })
        const c = canvas.current
        if (!c) return
        c.width = Math.floor(viewport.width)
        c.height = Math.floor(viewport.height)
        setHeight(Math.round(viewport.height / dpr))
        const t = page.render({ canvas: c, viewport })
        task = t
        await t.promise.catch(() => {})
      },
      { root: root.current, rootMargin: '600px 0px' },
    )
    observer.observe(el)
    return () => {
      observer.disconnect()
      task?.cancel()
    }
  }, [pdf, n, width, root])

  return (
    <div ref={holder} className="mx-auto mb-3 bg-white shadow-lg" style={{ width, height }}>
      <canvas ref={canvas} className="h-full w-full" />
    </div>
  )
}
