import { Album as AlbumIcon, Loader2, Plus } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { createAlbum, setInAlbum } from '../drive/ops'
import type { Album, Drive, FileItem } from '../drive/tree'
import { toast, toastError } from '../store/useToast'
import Dialog from './Dialog'
import { timelineItems } from './PhotoTimeline'
import Thumb from './Thumb'

export interface AlbumStats {
  count: number
  /** The newest photo (shown as the album's cover). */
  cover?: FileItem
}

/** Photo count and cover of every album, in one pass over the timeline (trash and locked folders left out). */
export function albumStats(drive: Drive): Map<string, AlbumStats> {
  const stats = new Map<string, AlbumStats>()
  for (const a of drive.albums.keys()) stats.set(a, { count: 0 })
  // Newest first, so the first photo seen is the cover
  for (const photo of timelineItems(drive, {})) {
    for (const a of photo.albums ?? []) {
      const s = stats.get(a)
      if (!s) continue
      s.count++
      s.cover ??= photo
    }
  }
  return stats
}

/** Newest album first. */
export function sortedAlbums(drive: Drive): Album[] {
  return [...drive.albums.values()].sort((a, b) => b.ts - a.ts)
}

const photos = (n: number) => `${n} photo${n === 1 ? '' : 's'}`

/** TelePhotos → Albums: a card per album (cover, name, count). Long-press or right-click for its menu. */
export function AlbumGrid(props: { drive: Drive; onOpen: (a: Album) => void; onMenu: (a: Album, x: number, y: number) => void }) {
  const { drive, onOpen, onMenu } = props
  const stats = useMemo(() => albumStats(drive), [drive])
  const pointer = useRef('mouse')
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] md:gap-x-4.5">
      {sortedAlbums(drive).map((a) => {
        const s = stats.get(a.id) ?? { count: 0 }
        return (
          <button
            key={a.id}
            className="min-w-0 text-left"
            onPointerDown={(e) => (pointer.current = e.pointerType)}
            onClick={() => onOpen(a)}
            onContextMenu={(e) => {
              e.preventDefault()
              onMenu(a, e.clientX, e.clientY)
            }}
          >
            <span className="flex aspect-square items-center justify-center overflow-hidden rounded-md bg-surface pressed">
              {s.cover ? <Thumb item={s.cover} iconClass="size-8" /> : <AlbumIcon className="size-9 text-muted" strokeWidth={1.5} />}
            </span>
            <span className="mt-2 block truncate text-[15px] font-extrabold">{a.name}</span>
            <span className="block text-xs text-muted">{photos(s.count)}</span>
          </button>
        )
      })}
    </div>
  )
}

/** "Add to album": pick an album for the selected photos, or make a new one. */
export function AddToAlbumDialog(props: { drive: Drive; files: FileItem[]; onDone: (album: Album | null) => void }) {
  const { drive, files, onDone } = props
  const stats = useMemo(() => albumStats(drive), [drive])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const addTo = async (albumId: string, albumName: string) => {
    setBusy(albumId)
    try {
      await setInAlbum(files, albumId, true)
      toast(`Added ${photos(files.length)} to “${albumName}”`)
      onDone(drive.albums.get(albumId) ?? null)
    } catch (e) {
      toastError(e)
      setBusy(null)
    }
  }

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy('new')
    try {
      const id = await createAlbum(name)
      await addTo(id, name.trim())
    } catch (err) {
      toastError(err)
      setBusy(null)
    }
  }

  return (
    <Dialog title="Add to album" subtitle={photos(files.length)} onClose={() => onDone(null)}>
      <form className="mb-4 flex gap-2" onSubmit={create}>
        <input
          className="input min-w-0 flex-1"
          placeholder="New album name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="New album name"
        />
        <button className="btn-primary shrink-0" disabled={!name.trim() || !!busy}>
          {busy === 'new' ? <Loader2 className="animate-spin" /> : <Plus />} Create
        </button>
      </form>
      {drive.albums.size > 0 && (
        <ul className="max-h-80 space-y-1 overflow-y-auto pb-2">
          {sortedAlbums(drive).map((a) => {
            const s = stats.get(a.id) ?? { count: 0 }
            const all = files.every((f) => f.albums?.includes(a.id))
            return (
              <li key={a.id}>
                <button
                  className="flex w-full items-center gap-3 rounded-md p-2 text-left active:pressed disabled:opacity-50"
                  disabled={!!busy || all}
                  onClick={() => void addTo(a.id, a.name)}
                >
                  <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface raised-xs">
                    {s.cover ? <Thumb item={s.cover} iconClass="size-5" /> : <AlbumIcon className="size-5 text-muted" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{a.name}</span>
                    <span className="block text-xs text-muted">{all ? 'Already in this album' : photos(s.count)}</span>
                  </span>
                  {busy === a.id && <Loader2 className="size-4 animate-spin text-muted" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Dialog>
  )
}
