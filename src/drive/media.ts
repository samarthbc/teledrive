import type { UploadSource } from './upload'

/**
 * When a photo or video was taken, and its size: stored with the file (encrypted) so TelePhotos can show a timeline
 * by date taken. From Android's photo library for camera backups, else from the photo's EXIF data, else the file's
 * last-modified time.
 */
export interface MediaInfo {
  /** Date taken (unix seconds). */
  dt?: number
  /** Width and height in pixels, as shown (rotation applied). */
  wh?: [number, number]
}

const EXIF_BYTES = 256 * 1024

export function isMediaType(mime: string): boolean {
  return mime.startsWith('image/') || mime.startsWith('video/')
}

export async function mediaInfo(file: UploadSource, mime: string): Promise<MediaInfo> {
  if (!isMediaType(mime)) return {}
  const info: MediaInfo = {}
  if (file.taken) info.dt = file.taken
  if (file.width && file.height) info.wh = [file.width, file.height]
  if ((!info.dt || !info.wh) && /jpe?g$/i.test(mime)) {
    try {
      const exif = readExif(await file.slice(0, EXIF_BYTES).arrayBuffer())
      info.dt ??= exif.dt
      info.wh ??= exif.wh
    } catch {
      // Not readable: fall back below
    }
  }
  if (!info.dt && file.lastModified > 0) info.dt = Math.floor(file.lastModified / 1000)
  return info
}

/** Date taken, size and rotation from a JPEG's EXIF block (the start of the file is enough). */
export function readExif(buf: ArrayBuffer): MediaInfo {
  const v = new DataView(buf)
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return {}
  let p = 2
  while (p + 4 <= v.byteLength) {
    const marker = v.getUint16(p)
    const len = v.getUint16(p + 2)
    if ((marker & 0xff00) !== 0xff00) return {}
    // APP1 "Exif\0\0"
    if (marker === 0xffe1 && p + 10 <= v.byteLength && v.getUint32(p + 4) === 0x45786966 && v.getUint16(p + 8) === 0) {
      return parseTiff(v, p + 10)
    }
    // Start of scan: no EXIF before the image data
    if (marker === 0xffda) return {}
    p += 2 + len
  }
  return {}
}

const TAG_EXIF_IFD = 0x8769
const TAG_ORIENTATION = 0x0112
const TAG_DATETIME = 0x0132
const TAG_DATETIME_ORIGINAL = 0x9003
const TAG_WIDTH = 0xa002
const TAG_HEIGHT = 0xa003

function parseTiff(v: DataView, start: number): MediaInfo {
  const little = v.getUint16(start) === 0x4949
  const u16 = (o: number) => v.getUint16(start + o, little)
  const u32 = (o: number) => v.getUint32(start + o, little)
  const tags = new Map<number, number | string>()

  const readIfd = (offset: number) => {
    if (start + offset + 2 > v.byteLength) return
    const count = u16(offset)
    for (let i = 0; i < count; i++) {
      const e = offset + 2 + i * 12
      if (start + e + 12 > v.byteLength) return
      const tag = u16(e)
      const type = u16(e + 2)
      const n = u32(e + 4)
      if (type === 3) tags.set(tag, u16(e + 8)) // SHORT
      else if (type === 4) tags.set(tag, u32(e + 8)) // LONG
      else if (type === 2 && n >= 19) {
        // ASCII, "YYYY:MM:DD HH:MM:SS\0" (longer than 4 bytes: stored at an offset)
        const at = start + u32(e + 8)
        if (at + 19 > v.byteLength) continue
        let s = ''
        for (let k = 0; k < 19; k++) s += String.fromCharCode(v.getUint8(at + k))
        tags.set(tag, s)
      }
    }
  }

  readIfd(u32(4))
  const exifIfd = tags.get(TAG_EXIF_IFD)
  if (typeof exifIfd === 'number') readIfd(exifIfd)

  const info: MediaInfo = {}
  const date = tags.get(TAG_DATETIME_ORIGINAL) ?? tags.get(TAG_DATETIME)
  if (typeof date === 'string') {
    const m = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(date)
    // EXIF times have no time zone: the camera's local time
    if (m && m[1] !== '0000') {
      const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime()
      if (!Number.isNaN(t)) info.dt = Math.floor(t / 1000)
    }
  }
  const w = tags.get(TAG_WIDTH)
  const h = tags.get(TAG_HEIGHT)
  if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) {
    // Orientations 5-8 are rotated by 90°: shown the other way round
    const o = tags.get(TAG_ORIENTATION)
    info.wh = typeof o === 'number' && o >= 5 && o <= 8 ? [h, w] : [w, h]
  }
  return info
}
