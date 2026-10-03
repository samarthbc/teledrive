import { describe, expect, it } from 'vitest'
import { mediaInfo, readExif } from './media'
import type { UploadSource } from './upload'

/** A JPEG start with an EXIF block: IFD0 (orientation, pointer to the EXIF IFD), EXIF IFD (date, size). */
function jpegWithExif(opts: { little?: boolean; date?: string; w?: number; h?: number; orientation?: number }): ArrayBuffer {
  const little = !!opts.little
  const tiff = new DataView(new ArrayBuffer(200))
  const u16 = (o: number, x: number) => tiff.setUint16(o, x, little)
  const u32 = (o: number, x: number) => tiff.setUint32(o, x, little)
  u16(0, little ? 0x4949 : 0x4d4d)
  u16(2, 42)
  u32(4, 8)
  // IFD0 at 8: 2 entries
  u16(8, 2)
  u16(10, 0x0112); u16(12, 3); u32(14, 1); u16(18, opts.orientation ?? 1)
  u16(22, 0x8769); u16(24, 4); u32(26, 1); u32(30, 38)
  u32(34, 0)
  // EXIF IFD at 38: 3 entries; the date string at 80
  u16(38, 3)
  u16(40, 0x9003); u16(42, 2); u32(44, 20); u32(48, 80)
  u16(52, 0xa002); u16(54, 4); u32(56, 1); u32(60, opts.w ?? 4000)
  u16(64, 0xa003); u16(66, 4); u32(68, 1); u32(72, opts.h ?? 3000)
  const date = opts.date ?? '2025:08:14 18:30:05'
  for (let i = 0; i < date.length; i++) tiff.setUint8(80 + i, date.charCodeAt(i))

  const app1Len = 2 + 6 + tiff.byteLength
  const out = new Uint8Array(2 + 2 + app1Len + 2)
  const v = new DataView(out.buffer)
  v.setUint16(0, 0xffd8)
  v.setUint16(2, 0xffe1)
  v.setUint16(4, app1Len)
  out.set([0x45, 0x78, 0x69, 0x66, 0, 0], 6)
  out.set(new Uint8Array(tiff.buffer), 12)
  v.setUint16(12 + tiff.byteLength, 0xffda)
  return out.buffer
}

const local = (y: number, mo: number, d: number, h: number, mi: number, s: number) =>
  Math.floor(new Date(y, mo - 1, d, h, mi, s).getTime() / 1000)

describe('readExif', () => {
  it('reads the date taken and size (big-endian)', () => {
    expect(readExif(jpegWithExif({}))).toEqual({ dt: local(2025, 8, 14, 18, 30, 5), wh: [4000, 3000] })
  })

  it('reads little-endian EXIF and swaps the size for rotated photos', () => {
    const info = readExif(jpegWithExif({ little: true, orientation: 6, w: 4000, h: 3000, date: '2024:01:02 03:04:05' }))
    expect(info).toEqual({ dt: local(2024, 1, 2, 3, 4, 5), wh: [3000, 4000] })
  })

  it('ignores empty dates and non-JPEG data', () => {
    expect(readExif(jpegWithExif({ date: '0000:00:00 00:00:00' })).dt).toBeUndefined()
    expect(readExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toEqual({})
  })
})

describe('mediaInfo', () => {
  const source = (bytes: ArrayBuffer, extra: Partial<UploadSource> = {}): UploadSource => {
    const blob = new Blob([bytes])
    return Object.assign(blob, { name: 'a.jpg', lastModified: 1_700_000_000_000, ...extra }) as unknown as UploadSource
  }

  it('prefers what the phone knows, then EXIF, then the file time', async () => {
    const exif = jpegWithExif({})
    expect(await mediaInfo(source(exif, { taken: 123, width: 10, height: 20 }), 'image/jpeg')).toEqual({ dt: 123, wh: [10, 20] })
    expect(await mediaInfo(source(exif), 'image/jpeg')).toEqual({ dt: local(2025, 8, 14, 18, 30, 5), wh: [4000, 3000] })
    expect(await mediaInfo(source(new ArrayBuffer(8)), 'video/mp4')).toEqual({ dt: 1_700_000_000 })
  })

  it('stores nothing for other files', async () => {
    expect(await mediaInfo(source(new ArrayBuffer(8)), 'application/pdf')).toEqual({})
  })
})
