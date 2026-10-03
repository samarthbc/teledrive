import { ROOT } from './meta'
import { isHidden, listFolder, lockedPhotosFolder, type Drive, type FileItem, type Item } from './tree'

/** When a photo was taken; files without a date taken (older uploads) use their upload time. */
export function photoDate(item: FileItem): number {
  return item.taken || item.ts
}

/** Newest first. */
export function sortPhotos(items: FileItem[]): FileItem[] {
  return [...items].sort((a, b) => photoDate(b) - photoDate(a))
}

/**
 * TelePhotos' timeline: every photo and video not in the trash or a locked folder, newest first by date taken.
 * Narrowed to starred ones, a source folder (or "videos"), or an album; `notInAlbum` leaves out an album's photos
 * (when picking photos to add to it). Locked photos never show, even while unlocked; `locked` lists only them.
 */
export function timelineItems(
  drive: Drive,
  opts: { starred?: boolean; source?: string | null; album?: string; notInAlbum?: string; locked?: boolean },
): FileItem[] {
  const out: FileItem[] = []
  const lockedId = lockedPhotosFolder(drive)?.id
  if (opts.locked && !lockedId) return out
  for (const i of drive.items.values()) {
    if (i.kind !== 'file' || i.locked || !/^(image|video)\//.test(i.mime)) continue
    if (opts.locked ? i.parent !== lockedId : i.parent === lockedId) continue
    if (opts.starred && !i.x.fav) continue
    if (opts.album && !i.albums?.includes(opts.album)) continue
    if (opts.notInAlbum && i.albums?.includes(opts.notInAlbum)) continue
    if (opts.source && !inSource(drive, i, opts.source)) continue
    if (isHidden(drive, i)) continue
    out.push(i)
  }
  return sortPhotos(out)
}

/** The timeline's chips that are always there, by kind of file. */
export const KIND_CHIPS = [
  { id: 'photos', name: 'Photos' },
  { id: 'videos', name: 'Videos' },
  { id: 'gifs', name: 'GIFs' },
] as const

const isGif = (i: FileItem) => i.mime === 'image/gif'

/** Is the photo in a chip: a kind ("photos", "videos", "gifs") or a top folder's ID. */
function inSource(drive: Drive, i: FileItem, source: string): boolean {
  if (source === 'photos') return i.mime.startsWith('image/') && !isGif(i)
  if (source === 'videos') return i.mime.startsWith('video/')
  if (source === 'gifs') return isGif(i)
  return topFolder(drive, i) === source
}

/**
 * The timeline's folder chips: the folders at the top (Camera, Screenshots…) that have photos or videos in the
 * timeline. A folder that's been emptied (all its photos deleted) gets no chip.
 */
export function photoSources(drive: Drive): Item[] {
  const used = new Set<string>()
  for (const i of timelineItems(drive, {})) used.add(topFolder(drive, i))
  return listFolder(drive, ROOT).filter((i) => i.kind === 'folder' && !i.locked && !i.x.lp && used.has(i.id))
}

/** The folder at the top of the drive an item is in (its own ID if it's at the top). */
function topFolder(drive: Drive, item: Item): string {
  let cur = item
  for (let n = 0; n < 100 && cur.parent !== ROOT; n++) {
    const up = drive.items.get(cur.parent)
    if (!up) break
    cur = up
  }
  return cur.id
}
