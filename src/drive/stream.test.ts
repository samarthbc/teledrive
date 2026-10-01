import { describe, expect, it, vi } from 'vitest'
import type { FileItem, Part } from './tree'

const MB = 1024 * 1024

// Fake Telegram: each part's byte at offset i has value (partNumber * 50 + global block index) & 255
vi.mock('./download', () => ({
  BLOCK_SIZE: 1024 * 1024,
  fetchBlock: vi.fn(async (part: Part, offset: number) => {
    const size = part.doc!.size
    const len = Math.min(1024 * 1024, size - offset)
    const out = new Uint8Array(len)
    for (let i = 0; i < len; i++) out[i] = byteAt(part.pt, offset + i)
    return out
  }),
}))

const PART1 = 2 * MB
function byteAt(pt: number, offsetInPart: number) {
  return (pt * 50 + Math.floor(offsetInPart / 1000)) & 255
}
/** Expected byte at a position in the whole file. */
function expected(pos: number) {
  return pos < PART1 ? byteAt(1, pos) : byteAt(2, pos - PART1)
}

const { readRange } = await import('./stream')

const doc = (size: number) => ({ docId: '1', accessHash: '1', fileRef: new Uint8Array(), dcId: 1, size })
const file: FileItem = {
  kind: 'file', id: 'f', parent: 'root', name: 'v.mp4', msgId: 1, ts: 0, x: {}, mime: 'video/mp4',
  size: PART1 + 1.5 * MB, partsTotal: 2, complete: true, locked: false, level: 'root', concealed: false,
  parts: [{ pt: 1, msgId: 1, doc: doc(PART1) }, { pt: 2, msgId: 2, doc: doc(1.5 * MB) }],
}

function check(start: number, bytes: Uint8Array) {
  for (let i = 0; i < bytes.length; i += 997) expect(bytes[i]).toBe(expected(start + i))
  expect(bytes[bytes.length - 1]).toBe(expected(start + bytes.length - 1))
}

describe('readRange', () => {
  it('reads from the start, capped at 2 MB', async () => {
    const bytes = await readRange(file, 0)
    expect(bytes.length).toBe(2 * MB)
    check(0, bytes)
  })

  it('reads an unaligned range across a block boundary', async () => {
    const start = MB - 10
    const bytes = await readRange(file, start, start + 99)
    expect(bytes.length).toBe(100)
    check(start, bytes)
  })

  it('reads across the boundary between two parts', async () => {
    const start = PART1 - 500
    const bytes = await readRange(file, start, PART1 + 499)
    expect(bytes.length).toBe(1000)
    check(start, bytes)
  })

  it('stops at the end of the file', async () => {
    const start = file.size - 300
    const bytes = await readRange(file, start)
    expect(bytes.length).toBe(300)
    check(start, bytes)
  })
})
