import { afterEach, describe, expect, it } from 'vitest'
import {
  CIPHER_BLOCK, changeLockPassword, checkAccountPassword, cipherSize, createAccount, decryptBlock, decryptThumb,
  EncryptedSource, encryptThumb, moveLock, newFileKey, newLock, openFileKey, openLock, PLAIN_BLOCK, rewrapFileKey, seal,
  unlockAccount, unseal, WrongPasswordError,
} from './crypto'
import { closeAllLocks, openLevel, setAccount } from './keyring'
import { decode, encode, ROOT, type Meta } from './meta'
import { keyView, purgeClosedSecrets, resolveSecrets, unresolved } from './secrets'
import { buildDrive, LOCKED_FOLDER_NAME, type MessageRecord } from './tree'
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
  setAccount(null)
  purgeClosedSecrets()
})

// PBKDF2 with 600k iterations takes a moment per password
const SLOW = { timeout: 60_000 }

describe('TeleDrive password', () => {
  it('opens only with the right password', SLOW, async () => {
    const { config, keys } = await createAccount('correct horse battery')
    const sealed = await seal(keys.root, { n: 'secret.txt' })
    await expect(unlockAccount(config, 'wrong password')).rejects.toBeInstanceOf(WrongPasswordError)
    expect(await checkAccountPassword(config, 'nope')).toBe(false)
    const again = await unlockAccount(config, 'correct horse battery')
    expect(again.id).toBe(config.id)
    expect(await unseal(again.root, sealed)).toEqual({ n: 'secret.txt' })
  })
})

describe('locks', () => {
  it('need the parent level key and the item password; moving and changing the password keep the same key', SLOW, async () => {
    const { keys } = await createAccount('account password')
    const folderKey = (await createAccount('other')).keys.root
    const { lock, key } = await newLock(keys.root, 'item password')
    const wrapped = (await newFileKey(key)).wrapped

    await expect(openLock(lock, keys.root, 'wrong')).rejects.toBeInstanceOf(WrongPasswordError)
    await expect(openLock(lock, folderKey, 'item password')).rejects.not.toBeInstanceOf(WrongPasswordError)
    await openFileKey(await openLock(lock, keys.root, 'item password'), wrapped)

    // Moved into another level: the item password still works, with the new parent
    const moved = await moveLock(lock, keys.root, folderKey)
    await openFileKey(await openLock(moved, folderKey, 'item password'), wrapped)

    const changed = await changeLockPassword(moved, folderKey, 'item password', 'new item password')
    await expect(openLock(changed, folderKey, 'item password')).rejects.toBeInstanceOf(WrongPasswordError)
    await openFileKey(await openLock(changed, folderKey, 'new item password'), wrapped)
  })

  it('re-wraps file keys between levels without changing them', SLOW, async () => {
    const a = (await createAccount('a')).keys.root
    const b = (await createAccount('b')).keys.root
    const { wrapped, key } = await newFileKey(a)
    const block = await import('./crypto').then((c) => c.encryptBlock(key, 0, sample(100).buffer))
    const moved = await rewrapFileKey(wrapped, a, b)
    await expect(openFileKey(a, moved)).rejects.toThrow()
    expect(await decryptBlock(await openFileKey(b, moved), 0, block)).toEqual(sample(100))
  })
})

describe('file contents', () => {
  it('encrypts a file into 1 MB blocks that decrypt one by one', SLOW, async () => {
    const { key } = await newFileKey((await createAccount('pw123456')).keys.root)
    const plain = sample(2 * PLAIN_BLOCK + 1234)
    const src = new EncryptedSource(new Bytes(plain), key)
    expect(src.size).toBe(cipherSize(plain.length))
    expect(src.size).toBe(2 * CIPHER_BLOCK + 1234 + 16)

    // Read it the way uploads do: 512 KB parts
    const cipher = new Uint8Array(src.size)
    for (let o = 0; o < src.size; o += 512 * 1024) cipher.set(new Uint8Array(await src.slice(o, o + 512 * 1024).arrayBuffer()), o)

    const joined = new Uint8Array(plain.length)
    for (let b = 0; b * CIPHER_BLOCK < cipher.length; b++)
      joined.set(await decryptBlock(key, b, cipher.subarray(b * CIPHER_BLOCK, (b + 1) * CIPHER_BLOCK)), b * PLAIN_BLOCK)
    expect(Buffer.compare(joined, plain)).toBe(0) // (toEqual is very slow on MBs of data)

    // A block in the wrong place doesn't decrypt
    await expect(decryptBlock(key, 1, cipher.subarray(0, CIPHER_BLOCK))).rejects.toThrow()
  })

  it('encrypts thumbnails', SLOW, async () => {
    const { key } = await newFileKey((await createAccount('pw123456')).keys.root)
    const ct = new Uint8Array(await (await encryptThumb(key, new Blob([sample(5000)]))).arrayBuffer())
    expect(new Uint8Array(await (await decryptThumb(key, ct)).arrayBuffer())).toEqual(sample(5000))
  })
})

describe('locked folders in the tree', () => {
  it('hide their contents until unlocked', SLOW, async () => {
    const { config, keys } = await createAccount('account password')
    setAccount(keys, config)
    const { lock, key } = await newLock(keys.root, 'folder password')
    const folder = decode(encode({
      td: 1, t: 'd', id: 'box', p: ROOT, n: '', x: { enc: 1 }, e: await seal(key, { n: 'Private' }), l: lock,
    }))!
    expect(folder).toMatchObject({ t: 'd', l: lock })
    const inside: Meta = {
      td: 1, t: 'f', id: 'doc', p: 'box', n: '', s: 10, m: '', of: 1, ts: 1, x: { enc: 1 },
      k: (await newFileKey(key)).wrapped, e: await seal(key, { n: 'passport.pdf', m: 'application/pdf' }),
    }
    const records: MessageRecord[] = [{ msgId: 1, meta: folder, date: 1 }, { msgId: 2, meta: inside, date: 1, doc: undefined }]

    let drive = buildDrive(records, keyView)
    expect(drive.items.get('box')).toMatchObject({ name: LOCKED_FOLDER_NAME, locked: true, concealed: false, level: 'box' })
    expect(drive.items.get('doc')).toMatchObject({ concealed: true, level: 'box' })
    expect(drive.children.get('box')).toBeUndefined()

    openLevel('box', await openLock(lock, keys.root, 'folder password'))
    await resolveSecrets(unresolved(records))
    drive = buildDrive(records, keyView)
    expect(drive.items.get('box')).toMatchObject({ name: 'Private', locked: false })
    expect(drive.children.get('box')?.map((i) => i.name)).toEqual(['passport.pdf'])

    closeAllLocks()
    purgeClosedSecrets()
    expect(buildDrive(records, keyView).items.get('doc')).toMatchObject({ concealed: true })
  })

  it('show their own name while locked, readable with the folder they are in', SLOW, async () => {
    const { config, keys } = await createAccount('account password')
    setAccount(keys, config)
    const { lock, key } = await newLock(keys.root, 'folder password')
    const folder = decode(encode({
      td: 1, t: 'd', id: 'secrets', p: ROOT, n: '', x: { enc: 1 }, e: await seal(key, { n: 'Secrets' }), l: lock,
      ln: await seal(keys.root, { n: 'Secrets' }),
    }))!
    expect(folder).toMatchObject({ ln: expect.any(String) })
    const inside: Meta = {
      td: 1, t: 'f', id: 'note', p: 'secrets', n: '', s: 10, m: '', of: 1, ts: 1, x: { enc: 1 },
      k: (await newFileKey(key)).wrapped, e: await seal(key, { n: 'diary.txt', m: 'text/plain' }),
    }
    const records: MessageRecord[] = [{ msgId: 1, meta: folder, date: 1 }, { msgId: 2, meta: inside, date: 1 }]

    // Locked: its name shows (the folder it's in is open), what's inside doesn't
    await resolveSecrets(unresolved(records))
    const drive = buildDrive(records, keyView)
    expect(drive.items.get('secrets')).toMatchObject({ name: 'Secrets', locked: true })
    expect(drive.items.get('note')).toMatchObject({ concealed: true })
    expect(drive.items.get('note')?.name).not.toBe('diary.txt')
  })
})
