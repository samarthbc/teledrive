import { describe, expect, it } from 'vitest'
import { CAPTION_LIMIT, decode, encode, MetaError, ROOT, validateName, type Meta } from './meta'
import {
  breadcrumbs, buildDrive, collectTree, isDescendant, listFolder, messageIds, uniqueName,
  type MessageRecord,
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
    expect(decode('{"td":1,"t":"c","id":"x","pt":0}')).toBeNull()
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
