import { describe, expect, it } from 'vitest'
import { CAPTION_LIMIT, decode, encode, MetaError, ROOT, validateName, type Meta } from './meta'
import {
  breadcrumbs, buildDrive, collectTree, isDescendant, isHidden, listFolder, locationOf, messageIds, recentFiles,
  searchItems, starredItems, trashedItems, uniqueName, findDuplicate, hasFileOfSize, zipEntries, type MessageRecord,
} from './tree'

let nextMsg = 1
const rec = (meta: Meta, msgId = nextMsg++): MessageRecord => ({ msgId, meta, date: 1000 })
const folder = (id: string, p: string, n: string): Meta => ({ td: 1, t: 'd', id, p, n })
const file = (id: string, p: string, n: string, of = 1, s = 10): Meta =>
  ({ td: 1, t: 'f', id, p, n, s, m: 'text/plain', of, ts: 5 })
const chunk = (id: string, pt: number): Meta => ({ td: 1, t: 'c', id, pt })

describe('meta', () => {
  it('round-trips every type', () => {
    const metas: Meta[] = [folder('a', ROOT, 'A'), file('b', 'a', 'b.txt', 2), chunk('b', 2), { td: 1, t: 'cfg', app: 'teledrive' }]
    for (const m of metas) expect(decode(encode(m))).toEqual(expect.objectContaining(m))
  })

  it('ignores non-TeleDrive captions', () => {
    for (const t of [undefined, '', 'hello', '{bad json', '{"td":2,"t":"d"}', '{"td":1,"t":"zz"}', '{"td":1,"t":"f","id":"x"}', 'null'])
      expect(decode(t)).toBeNull()
  })

  it('rejects invalid part numbers', () => {
    expect(decode('{"td":1,"t":"c","id":"x","pt":-1}')).toBeNull()
    expect(decode('{"td":1,"t":"f","id":"x","p":"root","n":"a","s":1,"of":0}')).toBeNull()
  })

  it('enforces the caption limit', () => {
    expect(() => encode(folder('a', ROOT, 'x'.repeat(CAPTION_LIMIT)))).toThrow(MetaError)
  })

  it('validates names', () => {
    expect(validateName('ok.txt')).toBeNull()
    expect(validateName('  ')).not.toBeNull()
    expect(validateName('a/b')).not.toBeNull()
    expect(validateName('..')).not.toBeNull()
  })
})

describe('tree', () => {
  it('builds folders and files', () => {
    const d = buildDrive([rec(folder('f1', ROOT, 'Photos')), rec(file('a', 'f1', 'a.jpg')), rec(file('b', ROOT, 'b.txt'))])
    expect(listFolder(d, ROOT).map((i) => i.name).sort()).toEqual(['Photos', 'b.txt'])
    expect(listFolder(d, 'f1').map((i) => i.name)).toEqual(['a.jpg'])
  })

  it('assembles multi-part files and detects missing parts', () => {
    const d = buildDrive([rec(file('big', ROOT, 'big.bin', 3), 10), rec(chunk('big', 3), 12), rec(chunk('big', 2), 11), rec(file('half', ROOT, 'half.bin', 2), 20)])
    const big = d.items.get('big')!
    expect(big.kind === 'file' && big.parts.map((p) => p.msgId)).toEqual([10, 11, 12])
    expect(big.kind === 'file' && big.complete).toBe(true)
    const half = d.items.get('half')!
    expect(half.kind === 'file' && half.complete).toBe(false)
  })

  it('reports chunks without a file as orphans', () => {
    const d = buildDrive([rec(chunk('gone', 2), 50)])
    expect(d.orphanChunks).toEqual([50])
  })

  it('moves items with a missing parent to the root', () => {
    const d = buildDrive([rec(file('a', 'nope', 'a.txt'))])
    expect(listFolder(d, ROOT).map((i) => i.id)).toEqual(['a'])
  })

  it('breaks folder cycles', () => {
    const d = buildDrive([rec(folder('x', 'y', 'X'), 1), rec(folder('y', 'x', 'Y'), 2)])
    // Every item must be reachable from the root
    const reachable = collectTree(d, ROOT).map((i) => i.id).sort()
    expect(reachable).toEqual(['x', 'y'])
  })

  it('keeps the oldest message when IDs collide', () => {
    const d = buildDrive([rec(folder('dup', ROOT, 'Second'), 9), rec(folder('dup', ROOT, 'First'), 3)])
    expect(d.items.get('dup')!.name).toBe('First')
  })

  it('computes breadcrumbs and descendants', () => {
    const d = buildDrive([rec(folder('a', ROOT, 'A')), rec(folder('b', 'a', 'B')), rec(folder('c', 'b', 'C'))])
    expect(breadcrumbs(d, 'c').map((f) => f.name)).toEqual(['A', 'B', 'C'])
    expect(isDescendant(d, 'c', 'a')).toBe(true)
    expect(isDescendant(d, 'a', 'c')).toBe(false)
    expect(isDescendant(d, 'a', 'a')).toBe(true)
  })

  it('collects all message IDs of a folder tree', () => {
    const d = buildDrive([
      rec(folder('a', ROOT, 'A'), 1), rec(file('f', 'a', 'f.bin', 2), 2), rec(chunk('f', 2), 3), rec(file('g', ROOT, 'g'), 4),
    ])
    expect(messageIds(collectTree(d, 'a')).sort()).toEqual([1, 2, 3])
  })

  it('generates unique names', () => {
    const d = buildDrive([rec(file('a', ROOT, 'photo.jpg')), rec(file('b', ROOT, 'photo (1).jpg')), rec(folder('c', ROOT, 'Docs'))])
    expect(uniqueName(d, ROOT, 'photo.jpg')).toBe('photo (2).jpg')
    expect(uniqueName(d, ROOT, 'PHOTO.JPG')).toBe('PHOTO (2).JPG')
    expect(uniqueName(d, ROOT, 'docs')).toBe('docs (1)')
    expect(uniqueName(d, ROOT, 'new.txt')).toBe('new.txt')
    expect(uniqueName(d, ROOT, 'photo.jpg', 'a')).toBe('photo.jpg')
  })

  it('hides trashed items by default', () => {
    const d = buildDrive([rec({ ...folder('t', ROOT, 'Old'), x: { tr: 1 } } as Meta)])
    expect(listFolder(d, ROOT)).toEqual([])
    expect(listFolder(d, ROOT, true)).toHaveLength(1)
  })
})

describe('search, trash, starred, recent', () => {
  const build = () =>
    buildDrive([
      rec(folder('ph', ROOT, 'Photos'), 1),
      rec({ ...file('b', 'ph', 'Beach Café.jpg'), ts: 30 } as Meta, 2),
      rec({ ...folder('old', ROOT, 'Old stuff'), x: { tr: 100 } } as Meta, 3),
      rec({ ...file('in', 'old', 'beach-old.jpg'), ts: 50 } as Meta, 4),
      rec({ ...file('s', ROOT, 'notes.txt'), ts: 10, x: { fav: 1 } } as Meta, 5),
      rec({ ...file('t', 'ph', 'gone.jpg'), x: { tr: 200 } } as Meta, 6),
    ])

  it('finds items across folders, ignoring case and accents', () => {
    const d = build()
    expect(searchItems(d, 'cafe').map((i) => i.id)).toEqual(['b'])
    expect(searchItems(d, 'BEACH jpg').map((i) => i.id)).toEqual(['b'])
    expect(searchItems(d, '', (i) => i.kind === 'file').map((i) => i.id).sort()).toEqual(['b', 's'])
  })

  it('excludes trashed items and everything inside trashed folders', () => {
    const d = build()
    expect(isHidden(d, d.items.get('in')!)).toBe(true)
    expect(searchItems(d, 'beach').map((i) => i.id)).toEqual(['b'])
    expect(recentFiles(d).map((i) => i.id)).toEqual(['b', 's'])
  })

  it('lists only top-level trashed items', () => {
    expect(trashedItems(build()).map((i) => i.id).sort()).toEqual(['old', 't'])
  })

  it('lists starred items', () => {
    expect(starredItems(build()).map((i) => i.id)).toEqual(['s'])
  })

  it('describes item locations', () => {
    const d = build()
    expect(locationOf(d, d.items.get('b')!)).toBe('My Drive / Photos')
    expect(locationOf(d, d.items.get('s')!)).toBe('My Drive')
  })
})

describe('duplicates', () => {
  const H = 'a'.repeat(64)
  const withHash = (id: string, n: string, s: number, h?: string): Meta => ({ ...(file(id, ROOT, n, 1, s) as object), ...(h && { h }) }) as Meta

  it('matches by hash, or by name for files without a hash', () => {
    const d = buildDrive([rec(withHash('a', 'x.jpg', 100, H)), rec(withHash('b', 'old.jpg', 200))])
    expect(hasFileOfSize(d, 100)).toBe(true)
    expect(hasFileOfSize(d, 101)).toBe(false)
    expect(findDuplicate(d, 100, 'renamed.jpg', H)?.id).toBe('a')
    expect(findDuplicate(d, 100, 'x.jpg', 'b'.repeat(64))).toBeUndefined()
    expect(findDuplicate(d, 200, 'OLD.jpg', H)?.id).toBe('b')
    expect(findDuplicate(d, 200, 'other.jpg', H)).toBeUndefined()
  })
})

describe('zipEntries', () => {
  it('includes folders with their contents, keeps empty folders and skips incomplete files', () => {
    const d = buildDrive([
      rec(folder('f', ROOT, 'Trip')), rec(folder('e', 'f', 'Empty')), rec(file('a', 'f', 'a.jpg')),
      rec(file('b', 'f', 'broken.bin', 2)), rec(file('c', ROOT, 'a.jpg')),
    ])
    const { entries, skipped, bytes } = zipEntries(d, [d.items.get('f')!, d.items.get('c')!])
    expect(entries.map((e) => e.path).sort()).toEqual(['Trip', 'Trip/Empty', 'Trip/a.jpg', 'a.jpg'])
    expect(skipped).toBe(1)
    expect(bytes).toBe(20)
  })
})

describe('albums', () => {
  // Sealed fields stand in as "secret:<json>"; the view decrypts them
  const sealed = (o: object) => `secret:${JSON.stringify(o)}`
  const keys = { isOpen: () => true, secretOf: (s: string) => (s.startsWith('secret:') ? JSON.parse(s.slice(7)) : undefined) }
  const album = (id: string, n: string): Meta => ({ td: 1, t: 'a', id, ts: 9, x: { enc: 1 }, e: sealed({ n }) })
  const photo = (id: string, al?: string[]): Meta =>
    ({ td: 1, t: 'f', id, p: ROOT, n: '', s: 10, m: '', of: 1, ts: 5, x: { enc: 1 }, e: sealed({ n: `${id}.jpg`, m: 'image/jpeg', ...(al && { al }) }) })

  it('decodes album messages (encrypted names only)', () => {
    const a = album('al1', 'Goa')
    expect(decode(encode(a))).toEqual(a)
    expect(decode('{"td":1,"t":"a","id":"x","n":"plain"}')).toBeNull()
  })

  it('reads albums and which albums each photo is in', () => {
    const d = buildDrive([rec(album('al1', 'Goa')), rec(album('al2', 'Family')), rec(photo('p1', ['al1', 'al2'])), rec(photo('p2'))], keys)
    expect([...d.albums.values()].map((a) => a.name)).toEqual(['Goa', 'Family'])
    const p1 = d.items.get('p1')!
    expect(p1.kind === 'file' && p1.albums).toEqual(['al1', 'al2'])
    const p2 = d.items.get('p2')!
    expect(p2.kind === 'file' && p2.albums).toBeUndefined()
  })

  it('leaves out albums that were deleted (the photos stay)', () => {
    const d = buildDrive([rec(album('al1', 'Goa')), rec(photo('p1', ['al1', 'gone']))], keys)
    const p1 = d.items.get('p1')!
    expect(p1.kind === 'file' && p1.albums).toEqual(['al1'])
    expect(buildDrive([rec(photo('p1', ['gone']))], keys).items.get('p1')).toBeDefined()
  })
})
