/**
 * Document renderer that runs inside a sandboxed <iframe> (see components/SandboxedPreview.tsx).
 *
 * Office/Markdown renderers turn untrusted file content into HTML, and some of them (pptx-preview)
 * insert text with innerHTML. So they never run in the app itself: this frame has an opaque origin
 * (no access to the app's storage or Telegram session) and a CSP that blocks all network access.
 * It receives the file bytes by postMessage and only ever sends back status and link clicks.
 *
 * Built separately into a single script: `npm run build:frame`.
 */
import { renderAsync } from 'docx-preview'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { init as initPptx } from 'pptx-preview'
import * as XLSX from 'xlsx'

export type FrameKind = 'docx' | 'pptx' | 'sheet' | 'markdown'

export interface RenderMessage {
  type: 'render'
  kind: FrameKind
  bytes: ArrayBuffer
  dark: boolean
  /** Available width in CSS px. Measured by the app: a sandboxed frame may not know its own size yet. */
  width: number
}

const MAX_SHEET_ROWS = 5000
const MAX_SHEET_COLS = 200

function note(text: string) {
  const p = document.createElement('p')
  p.className = 'note'
  p.textContent = text
  return p
}

const root = document.getElementById('root')!
const post = (msg: object) => parent.postMessage(msg, '*')

window.addEventListener('message', async (e) => {
  if (e.source !== parent) return
  const msg = e.data as RenderMessage
  if (msg?.type !== 'render') return
  document.documentElement.classList.toggle('dark', msg.dark)
  try {
    await render(msg)
    post({ type: 'rendered' })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
})

// Links: web links open outside (via the app), in-document anchors scroll; nothing else navigates
document.addEventListener('click', (e) => {
  const a = (e.target as Element).closest?.('a')
  if (!a) return
  e.preventDefault()
  const href = a.getAttribute('href') ?? ''
  if (/^https?:\/\//i.test(href)) post({ type: 'open-link', url: href })
  else if (href.startsWith('#')) document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView()
})

async function render(msg: RenderMessage) {
  root.textContent = ''
  switch (msg.kind) {
    case 'docx':
      return renderDocx(msg.bytes, msg.width)
    case 'pptx':
      return renderPptx(msg.bytes, msg.width)
    case 'sheet':
      return renderSheet(msg.bytes)
    case 'markdown':
      return renderMarkdown(msg.bytes)
  }
}

async function renderDocx(bytes: ArrayBuffer, width: number) {
  root.className = 'docx-root'
  await renderAsync(new Blob([bytes]), root, undefined, {
    inWrapper: true,
    useBase64URL: true,
    ignoreLastRenderedPageBreak: true,
    renderComments: false,
    renderChanges: false,
    experimental: true,
  })
  // Pages are real paper width (e.g. 21 cm); shrink them to fit phone screens
  const page = root.querySelector<HTMLElement>('section.docx')
  if (page) {
    const scale = Math.min(1, (width - 16) / page.offsetWidth)
    if (scale < 1) root.style.setProperty('zoom', String(scale))
  }
}

async function renderPptx(bytes: ArrayBuffer, available: number) {
  root.className = 'pptx-root'
  const width = Math.max(240, Math.min(available - 16, 1100))
  const previewer = initPptx(root, { width, height: Math.round((width * 9) / 16), mode: 'list' })
  await previewer.preview(bytes)
  // The library swallows parse errors and just renders nothing
  if (!previewer.slideCount || !root.querySelector('.pptx-preview-wrapper')?.children.length)
    throw new Error("this presentation couldn't be read")
}

async function renderSheet(bytes: ArrayBuffer) {
  root.className = 'sheet-root'
  const wb = XLSX.read(bytes, { type: 'array', sheetRows: MAX_SHEET_ROWS + 1, cellDates: true })
  const tabs = document.createElement('div')
  tabs.className = 'tabs'
  const body = document.createElement('div')
  body.className = 'sheet'
  root.append(tabs, body)

  const show = (name: string) => {
    for (const b of tabs.children) b.classList.toggle('active', (b as HTMLElement).dataset.name === name)
    // Cell values as formatted text (dates, numbers), built with textContent: no HTML from the file
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: false, defval: '', blankrows: true })
    body.textContent = ''
    if (!rows.length) {
      body.append(note('This sheet is empty.'))
      return
    }
    const shown = rows.slice(0, MAX_SHEET_ROWS)
    const cols = Math.min(MAX_SHEET_COLS, Math.max(...shown.map((r) => r.length)))
    const table = document.createElement('table')
    const head = table.createTHead().insertRow()
    head.append(document.createElement('th'))
    for (let c = 0; c < cols; c++) {
      const th = document.createElement('th')
      th.textContent = XLSX.utils.encode_col(c)
      head.append(th)
    }
    const tbody = table.createTBody()
    shown.forEach((row, r) => {
      const tr = tbody.insertRow()
      const th = document.createElement('th')
      th.textContent = String(r + 1)
      tr.append(th)
      for (let c = 0; c < cols; c++) {
        const td = tr.insertCell()
        const v = row[c]
        td.textContent = v == null ? '' : String(v)
        if (v !== '' && !isNaN(Number(v))) td.className = 'num'
      }
    })
    body.append(table)
    if (rows.length > MAX_SHEET_ROWS) body.append(note(`Showing the first ${MAX_SHEET_ROWS} rows. Download the file to see everything.`))
  }

  for (const name of wb.SheetNames) {
    const b = document.createElement('button')
    b.textContent = name
    b.dataset.name = name
    b.onclick = () => show(name)
    tabs.append(b)
  }
  if (wb.SheetNames.length < 2) tabs.remove()
  if (wb.SheetNames[0]) show(wb.SheetNames[0])
}

async function renderMarkdown(bytes: ArrayBuffer) {
  root.className = 'md-root'
  const text = new TextDecoder().decode(bytes)
  const html = await marked.parse(text, { gfm: true })
  root.innerHTML = DOMPurify.sanitize(html)
}

// ---- Styles ----

const style = document.createElement('style')
style.textContent = `
  :root { color-scheme: light; --bg: #f1f5f9; --fg: #0f172a; --muted: #64748b; --line: #e2e8f0; --card: #fff; }
  :root.dark { color-scheme: dark; --bg: #020617; --fg: #e2e8f0; --muted: #94a3b8; --line: #1e293b; --card: #0f172a; }
  html, body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.6 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
  #root { padding: 8px; }
  .note { color: var(--muted); font-size: 13px; padding: 8px; }

  /* Word: keep pages white like paper */
  .docx-root .docx-wrapper { background: transparent !important; padding: 8px 0 !important; }
  .docx-root section.docx { box-shadow: 0 1px 4px rgba(0,0,0,.25) !important; margin-bottom: 16px !important; color: #000; }

  /* PowerPoint */
  .pptx-root { display: flex; justify-content: center; }
  .pptx-root .pptx-preview-wrapper { background: transparent !important; height: auto !important; overflow: visible !important; }
  .pptx-root .pptx-preview-slide-wrapper { box-shadow: 0 1px 4px rgba(0,0,0,.25); margin: 0 auto 16px !important; }

  /* Spreadsheets */
  .tabs { display: flex; gap: 4px; overflow-x: auto; padding-bottom: 8px; position: sticky; left: 0; }
  .tabs button { font: inherit; font-size: 13px; padding: 4px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--card); color: var(--fg); white-space: nowrap; }
  .tabs button.active { border-color: #2aabee; color: #2aabee; }
  .sheet { overflow: auto; }
  .sheet table { border-collapse: separate; border-spacing: 0; background: var(--card); font-size: 13px; }
  .sheet td, .sheet th { border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 4px 8px; white-space: nowrap; max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
  .sheet th { background: var(--bg); color: var(--muted); font-weight: 500; font-size: 12px; position: sticky; }
  .sheet thead th { top: 0; z-index: 1; text-align: center; }
  .sheet tbody th { left: 0; text-align: right; }
  .sheet thead th:first-child { left: 0; z-index: 2; }
  .sheet td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .sheet { max-height: calc(100vh - 60px); }

  /* Markdown */
  .md-root { max-width: 820px; margin: 0 auto; padding: 16px 20px !important; background: var(--card); border-radius: 12px; }
  .md-root h1, .md-root h2 { border-bottom: 1px solid var(--line); padding-bottom: .3em; }
  .md-root a { color: #2aabee; }
  .md-root code { background: var(--bg); padding: .15em .35em; border-radius: 4px; font-size: .9em; }
  .md-root pre { background: var(--bg); padding: 12px; border-radius: 8px; overflow: auto; }
  .md-root pre code { background: none; padding: 0; }
  .md-root img { max-width: 100%; }
  .md-root table { border-collapse: collapse; }
  .md-root th, .md-root td { border: 1px solid var(--line); padding: 4px 10px; }
  .md-root blockquote { margin: 0; padding-left: 1em; border-left: 4px solid var(--line); color: var(--muted); }
`
document.head.append(style)

post({ type: 'ready' })
