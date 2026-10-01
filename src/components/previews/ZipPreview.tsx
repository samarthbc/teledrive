import { File, Folder } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatBytes } from '../../lib/format'

interface Entry {
  name: string
  dir: boolean
  size: number
}

const MAX_ENTRIES = 2000

/** Lists what's inside a .zip (names only; nothing is extracted). */
export default function ZipPreview({ bytes, onError }: { bytes: ArrayBuffer; onError: (m: string) => void }) {
  const [entries, setEntries] = useState<Entry[] | null>(null)

  useEffect(() => {
    import('jszip')
      .then(({ default: JSZip }) => JSZip.loadAsync(bytes))
      .then((zip) => {
        const list: Entry[] = []
        zip.forEach((path, f) => {
          // Uncompressed size lives in a private field; fall back to 0 if it's missing
          const size = (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0
          list.push({ name: path, dir: f.dir, size })
        })
        list.sort((a, b) => a.name.localeCompare(b.name))
        setEntries(list)
      })
      .catch((e) => onError(e instanceof Error ? e.message : String(e)))
  }, [bytes, onError])

  if (!entries) return <p className="text-sm text-white/60">Reading archive…</p>
  const files = entries.filter((e) => !e.dir)
  return (
    <div className="h-full w-full max-w-3xl overflow-auto p-2 sm:p-4">
      <p className="mb-2 px-1 text-sm text-white/60">
        {files.length} file{files.length === 1 ? '' : 's'} · {formatBytes(files.reduce((n, f) => n + f.size, 0))} unpacked
      </p>
      <ul className="divide-y divide-white/10 rounded-lg bg-white/5 text-sm">
        {entries.slice(0, MAX_ENTRIES).map((e) => (
          <li key={e.name} className="flex items-center gap-3 px-3 py-2">
            {e.dir ? <Folder className="h-4 w-4 shrink-0 text-white/80" /> : <File className="h-4 w-4 shrink-0 text-white/50" />}
            <span className="min-w-0 flex-1 truncate">{e.name}</span>
            {!e.dir && <span className="shrink-0 text-white/50">{formatBytes(e.size)}</span>}
          </li>
        ))}
      </ul>
      {entries.length > MAX_ENTRIES && <p className="p-2 text-sm text-white/60">…and {entries.length - MAX_ENTRIES} more</p>}
    </div>
  )
}
