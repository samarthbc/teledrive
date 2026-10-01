import {
  File, FileArchive, FileAudio, FileCode, FileImage, FileSpreadsheet, FileText, FileVideo, Folder, Lock, Presentation,
  type LucideIcon,
} from 'lucide-react'
import type { Item } from '../drive/tree'

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

export function formatDate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' })
}

export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return ''
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.ceil(seconds % 60)}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

export type FileCategory = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'code' | 'other'

const EXT: Record<string, FileCategory> = {}
const add = (cat: FileCategory, exts: string) => exts.split(' ').forEach((e) => (EXT[e] = cat))
add('image', 'jpg jpeg png gif webp bmp svg heic heif avif tiff ico')
add('video', 'mp4 mkv mov avi webm m4v wmv flv 3gp')
add('audio', 'mp3 wav flac aac ogg m4a opus wma')
add('document', 'pdf doc docx txt md rtf odt xls xlsx csv ods ppt pptx odp epub')
add('archive', 'zip rar 7z tar gz bz2 xz iso')
add('code', 'js ts tsx jsx py java c cpp h cs go rs rb php html css json xml yml yaml sh sql')

export function category(item: Item): FileCategory | 'folder' {
  if (item.kind === 'folder') return 'folder'
  const [major] = item.mime.split('/')
  if (major === 'image' || major === 'video' || major === 'audio') return major
  const ext = item.name.split('.').pop()?.toLowerCase() ?? ''
  return EXT[ext] ?? 'other'
}

/** The item's icon. Ink like the text around it (Soft Swiss is monochrome); locked items are red. */
export function fileIcon(item: Item): { Icon: LucideIcon; color: string } {
  if (item.lock && item.locked) return { Icon: Lock, color: 'text-brand-ink' }
  const ext = item.name.split('.').pop()?.toLowerCase() ?? ''
  const ink = (Icon: LucideIcon) => ({ Icon, color: 'text-ink' })
  switch (category(item)) {
    case 'folder':
      return ink(Folder)
    case 'image':
      return ink(FileImage)
    case 'video':
      return ink(FileVideo)
    case 'audio':
      return ink(FileAudio)
    case 'archive':
      return ink(FileArchive)
    case 'code':
      return ink(FileCode)
    case 'document':
      if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return ink(FileSpreadsheet)
      if (['ppt', 'pptx', 'odp', 'key'].includes(ext)) return ink(Presentation)
      return ink(FileText)
    default:
      return ink(File)
  }
}

export type PreviewKind =
  | 'image' | 'video' | 'audio' | 'pdf' | 'text'
  | 'docx' | 'pptx' | 'sheet' | 'markdown' | 'zip'
  /** Old binary Office formats (.doc, .ppt…) and others no browser library can render. */
  | 'unsupported-office'
  | 'none'

const exts = (list: string) => new Set(list.split(' '))
const PREVIEW_EXT: [PreviewKind, Set<string>][] = [
  ['docx', exts('docx docm dotx dotm')],
  ['pptx', exts('pptx pptm ppsx ppsm potx')],
  ['sheet', exts('xlsx xlsm xlsb xls ods csv tsv')],
  ['markdown', exts('md markdown')],
  ['zip', exts('zip')],
  ['unsupported-office', exts('doc dot ppt pps pot odt odp rtf pages key numbers')],
]
const TEXT_EXT = exts('txt log json xml yml yaml ini cfg conf toml env srt vtt')

/** How the file can be previewed. */
export function previewKind(item: Item): PreviewKind {
  if (item.kind !== 'file') return 'none'
  const ext = item.name.split('.').pop()?.toLowerCase() ?? ''
  for (const [kind, set] of PREVIEW_EXT) if (set.has(ext)) return kind
  const cat = category(item)
  if (cat === 'image' || cat === 'video' || cat === 'audio') return cat
  if (item.mime === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (item.mime.startsWith('text/') || cat === 'code' || TEXT_EXT.has(ext)) return 'text'
  return 'none'
}

/** Filter chips: which files belong to each. */
export const FILTERS = {
  image: { label: 'Photos', match: (i: Item) => category(i) === 'image' },
  video: { label: 'Videos', match: (i: Item) => category(i) === 'video' },
  document: { label: 'Documents', match: (i: Item) => ['document', 'code'].includes(category(i)) },
  audio: { label: 'Audio', match: (i: Item) => category(i) === 'audio' },
} as const

export type FilterKey = keyof typeof FILTERS
