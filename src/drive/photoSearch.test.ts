import { describe, expect, it } from 'vitest'
import { ROOT, type Meta } from './meta'
import { searchPhotos } from './photoSearch'
import { buildDrive, type Drive, type FileItem, type MessageRecord } from './tree'

let nextMsg = 1
const rec = (meta: Meta): MessageRecord => ({ msgId: nextMsg++, meta, date: 1000 })
const folder = (id: string, n: string): Meta => ({ td: 1, t: 'd', id, p: ROOT, n })
const photo = (id: string, p: string, n: string, m = 'image/jpeg', s = 1000): Meta => ({ td: 1, t: 'f', id, p, n, s, m, of: 1, ts: 5 })

/** Unix seconds for a local date. */
const at = (y: number, mo: number, d: number) => new Date(y, mo - 1, d, 12).getTime() / 1000

function setup(): { drive: Drive; photos: FileItem[] } {
  const drive = buildDrive([
    rec(folder('cam', 'Camera')),
    rec(folder('ss', 'Screenshots')),
    rec(folder('wa', 'WhatsApp Images')),
    rec(photo('xmas', 'cam', 'IMG_1.jpg')),
    rec(photo('beach', 'cam', 'IMG_2.jpg')),
    rec(photo('vid', 'cam', 'VID_3.mp4', 'video/mp4', 200 * 1024 * 1024)),
    rec(photo('shot', 'ss', 'Screenshot_4.png', 'image/png')),
    rec(photo('wa1', 'wa', 'IMG-WA0001.jpg')),
  ])
  const taken: Record<string, number> = {
    xmas: at(2024, 12, 25),
    beach: at(2025, 7, 13), // a Sunday
    vid: at(2026, 9, 28),
    shot: at(2026, 10, 2),
    wa1: at(2023, 12, 4),
  }
  for (const [id, t] of Object.entries(taken)) (drive.items.get(id) as FileItem).taken = t
  ;(drive.items.get('beach') as FileItem).x.fav = 1
  drive.albums.set('goa', { id: 'goa', name: 'Goa trip', msgId: 99, ts: 1 })
  ;(drive.items.get('beach') as FileItem).albums = ['goa']
  const photos = ['xmas', 'beach', 'vid', 'shot', 'wa1'].map((id) => drive.items.get(id) as FileItem)
  return { drive, photos }
}

const now = new Date(2026, 9, 3, 15) // Sat 3 Oct 2026
const ids = (q: string) => {
  const { drive, photos } = setup()
  return searchPhotos(drive, photos, q, now).map((f) => f.id).sort()
}

describe('photo search', () => {
  it('finds dates', () => {
    expect(ids('2024')).toEqual(['xmas'])
    expect(ids('December')).toEqual(['wa1', 'xmas'])
    expect(ids('dec 2024')).toEqual(['xmas'])
    expect(ids('25 dec')).toEqual(['xmas'])
    expect(ids('dec 4')).toEqual(['wa1'])
    expect(ids('summer 2025')).toEqual(['beach'])
    expect(ids('sunday')).toEqual(['beach'])
    expect(ids('summer')).toEqual(['beach'])
  })

  it('finds relative dates', () => {
    expect(ids('yesterday')).toEqual(['shot'])
    expect(ids('this week')).toEqual(['shot', 'vid'])
    expect(ids('last month')).toEqual(['vid'])
    expect(ids('last year')).toEqual(['beach'])
    // In October, last summer is this year's
    expect(ids('last summer')).toEqual([])
    expect(ids('last winter')).toEqual([])
    expect(ids('this year videos')).toEqual(['vid'])
  })

  it('finds kinds, folders, albums and names', () => {
    expect(ids('videos')).toEqual(['vid'])
    expect(ids('large videos')).toEqual(['vid'])
    expect(ids('starred')).toEqual(['beach'])
    expect(ids('png')).toEqual(['shot'])
    expect(ids('screenshot')).toEqual(['shot'])
    expect(ids('whatsapp')).toEqual(['wa1'])
    expect(ids('goa')).toEqual(['beach'])
    expect(ids('img_1')).toEqual(['xmas'])
    expect(ids('nothing here')).toEqual([])
    expect(ids('  ')).toEqual([])
  })
})
