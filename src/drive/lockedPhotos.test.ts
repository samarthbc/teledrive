import { describe, expect, it } from 'vitest'
import { timelineItems } from './photos'
import { ROOT, type Meta } from './meta'
import { searchPhotos } from './photoSearch'
import { buildDrive, lockedPhotosFolder, type MessageRecord } from './tree'

let nextMsg = 1
const rec = (meta: Meta): MessageRecord => ({ msgId: nextMsg++, meta, date: 1000 })
const photo = (id: string, p: string, n: string): Meta => ({ td: 1, t: 'f', id, p, n, s: 10, m: 'image/jpeg', of: 1, ts: 5 })

// The Locked photos folder while it's open (its key in hand): its photos are readable but must stay out of the timeline
const drive = () =>
  buildDrive([
    rec({ td: 1, t: 'd', id: 'cam', p: ROOT, n: 'Camera' }),
    rec({ td: 1, t: 'd', id: 'lp', p: ROOT, n: 'Locked photos', x: { lp: 1 } }),
    rec(photo('a', 'cam', 'a.jpg')),
    rec(photo('b', 'cam', 'b.jpg')),
    rec(photo('secret', 'lp', 'secret.jpg')),
  ])

const ids = (list: { id: string }[]) => list.map((i) => i.id).sort()

describe('locked photos', () => {
  it('finds the folder', () => {
    expect(lockedPhotosFolder(drive())?.id).toBe('lp')
    expect(lockedPhotosFolder(buildDrive([rec(photo('a', ROOT, 'a.jpg'))]))).toBeUndefined()
  })

  it('keeps them out of the timeline, starred, albums and search', () => {
    const d = drive()
    const secret = d.items.get('secret')!
    secret.x.fav = 1
    if (secret.kind === 'file') secret.albums = ['al']
    d.albums.set('al', { id: 'al', name: 'Trip', msgId: 99, ts: 1 })
    expect(ids(timelineItems(d, {}))).toEqual(['a', 'b'])
    expect(timelineItems(d, { starred: true })).toEqual([])
    expect(timelineItems(d, { album: 'al' })).toEqual([])
    expect(searchPhotos(d, timelineItems(d, {}), 'secret')).toEqual([])
  })

  it('lists only them in Locked photos', () => {
    expect(ids(timelineItems(drive(), { locked: true }))).toEqual(['secret'])
    expect(timelineItems(buildDrive([rec(photo('a', ROOT, 'a.jpg'))]), { locked: true })).toEqual([])
  })
})
