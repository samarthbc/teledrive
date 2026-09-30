import { afterEach, describe, expect, it } from 'vitest'
import {
  CIPHER_BLOCK, changePassword, cipherSize, createEncryption, decryptBlock, decryptThumb, EncryptedSource, encryptThumb,
  fileKey, newFileSalt, open, PLAIN_BLOCK, seal, setKeys, unlockKeys, WrongPasswordError,
} from './crypto'
import { decode, encode, ROOT, type Meta } from './meta'
import { secretOf, resolveSecrets, unresolved, clearSecrets } from './secrets'
import { buildDrive, LOCKED_FILE_NAME, type MessageRecord } from './tree'
import type { ByteSource } from './upload'

/** In-memory ByteSource over a Uint8Array. */
class Bytes implements ByteSource {
  constructor(private data: Uint8Array) {}
  get size() {
    return this.data.length
  }
  slice(start = 0, end = this.size) {
    return new Bytes(this.data.subarray(start, end))
  }
  async arrayBuffer() {
    return this.data.slice().buffer
  }
}

function sample(n: number) {
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = (i * 31 + 7) & 255
  return out
}

afterEach(() => {
  setKeys(null)
  clearSecrets()
})

describe('crypto', () => {
  it('unlocks with the right password only, and keeps the key across a password change', { timeout: 30_000 }, async () => {
    const { config, keys } = await createEncryption('correct horse')
    setKeys(keys)
    const sealed = await seal({ n: 'secret.txt' })

    await expect(unlockKeys(config, 'wrong password')).rejects.toBeInstanceOf(WrongPasswordError)
    const changed = await changePassword(config, 'correct horse', 'battery staple')
    expect(changed.id).toBe(config.id)
    await expect(unlockKeys(changed, 'correct horse')).rejects.toBeInstanceOf(WrongPasswordError)

    setKeys(await unlockKeys(changed, 'battery staple'))
    expect(await open(sealed)).toEqual({ n: 'secret.txt' })
  })

  it('encrypts a file into 1 MB blocks that decrypt one by one', { timeout: 30_000 }, async () => {
    setKeys((await createEncryption('pw123456')).keys)
    const key = await fileKey(newFileSalt())
    const plain = sample(2 * PLAIN_BLOCK + 1234)
    const src = new EncryptedSource(new Bytes(plain), key)
    expect(src.size).toBe(cipherSize(plain.length))
    expect(src.size).toBe(2 * CIPHER_BLOCK + 1234 + 16)

    // Read it the way uploads do: 512 KB parts
    const parts: Uint8Array[] = []
    for (let o = 0; o < src.size; o += 512 * 1024) parts.push(new Uint8Array(await src.slice(o, o + 512 * 1024).arrayBuffer()))
    const cipher = new Uint8Array(src.size)
    parts.reduce((o, p) => (cipher.set(p, o), o + p.length), 0)

    const out: Uint8Array[] = []
    for (let b = 0; b * CIPHER_BLOCK < cipher.length; b++)
      out.push(await decryptBlock(key, b, cipher.subarray(b * CIPHER_BLOCK, (b + 1) * CIPHER_BLOCK)))
    const joined = new Uint8Array(plain.length)
    out.reduce((o, p) => (joined.set(p, o), o + p.length), 0)
    expect(Buffer.compare(joined, plain)).toBe(0) // (toEqual is very slow on MBs of data)

    // A block in the wrong place doesn't decrypt
    await expect(decryptBlock(key, 1, cipher.subarray(0, CIPHER_BLOCK))).rejects.toThrow()
  })

  it('encrypts thumbnails', async () => {
    setKeys((await createEncryption('pw123456')).keys)
    const key = await fileKey(newFileSalt())
    const thumb = new Blob([sample(5000)])
    const ct = new Uint8Array(await (await encryptThumb(key, thumb)).arrayBuffer())
    expect(new Uint8Array(await (await decryptThumb(key, ct)).arrayBuffer())).toEqual(sample(5000))
  })
})

describe('encrypted items', () => {
  it('show real names only when unlocked', async () => {
    const { keys } = await createEncryption('pw123456')
    setKeys(keys)
    const e = await seal({ n: 'Taxes 2026.pdf', m: 'application/pdf' })
    const salt = newFileSalt()
    const meta = decode(encode({ td: 1, t: 'f', id: 'a', p: ROOT, n: '', s: 10, m: '', of: 1, ts: 1, x: { enc: 1 }, k: salt, e }))!
    expect(meta).toMatchObject({ t: 'f', n: '', e, k: salt })
    const thumb: Meta = { td: 1, t: 'c', id: 'a', pt: 0 }
    const records: MessageRecord[] = [{ msgId: 1, meta, date: 1 }, { msgId: 2, meta: thumb, date: 1 }]

    await resolveSecrets(unresolved(records))
    const open = buildDrive(records, secretOf).items.get('a')!
    expect(open).toMatchObject({ name: 'Taxes 2026.pdf', mime: 'application/pdf', locked: false, salt })
    expect(open.kind === 'file' && open.thumbPart?.msgId).toBe(2)

    setKeys(null)
    clearSecrets()
    const locked = buildDrive(records, secretOf).items.get('a')!
    expect(locked).toMatchObject({ name: LOCKED_FILE_NAME, locked: true })
  })
})
