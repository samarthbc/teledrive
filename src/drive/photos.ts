import { ROOT } from './meta'
import { isHidden, lockedPhotosFolder, type Drive, type FileItem, type Item } from './tree'

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
    if (opts.source === 'videos' ? !i.mime.startsWith('video/') : opts.source && topFolder(drive, i) !== opts.source) continue
    if (isHidden(drive, i)) continue
    out.push(i)
  }
  return sortPhotos(out)
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
