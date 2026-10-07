import { describe, expect, it } from 'vitest'
import { WrongPasswordError, randomBytes, importAes } from '../drive/crypto'
import {
  changePassword, checkRecoveryCode, createVault, DamagedItemError, newCode, newRecoveryCode, openWithPassword, parseRecoveryCode,
  readHint, recover, sealItem, unsealItem, WrongCodeError, type Kdf,
} from './vaultCrypto'

// Small Argon2id parameters keep the tests fast; the app uses DEFAULT_KDF
const FAST: Kdf = { a: 'argon2id', m: 1024, t: 1, p: 1 }
const rootKey = () => importAes(randomBytes(32))
const PW = 'correct horse battery staple'

async function roundTrip(key: CryptoKey) {
  const sealed = await sealItem(key, 'abc', { n: 'x' })
  return unsealItem<{ n: string }>(key, 'abc', sealed)
}

describe('recovery code', () => {
  it('is 8 groups of 4 Crockford characters and parses back', () => {
    const code = newRecoveryCode()
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/)
    expect(parseRecoveryCode(code)).toHaveLength(20)
  })
  it('ignores case, spaces and dashes; reads I/L as 1 and O as 0', () => {
    const code = newRecoveryCode()
    const bytes = parseRecoveryCode(code)!
    expect(parseRecoveryCode(code.toLowerCase().replace(/-/g, ' '))).toEqual(bytes)
    expect(parseRecoveryCode(code.replace(/1/g, 'l').replace(/0/g, 'o'))).toEqual(bytes)
  })
  it('rejects wrong lengths and characters', () => {
    expect(parseRecoveryCode('ABCD')).toBeNull()
    expect(parseRecoveryCode('U'.repeat(32))).toBeNull()
  })
})

describe('vault key', () => {
  it('opens with the master password and the root key only', async () => {
    const root = await rootKey()
    const { config, key } = await createVault(root, PW, '', FAST)
    const opened = await openWithPassword(config, root, PW)
    const sealed = await sealItem(key, 'abc', { n: 'x' })
    expect((await unsealItem<{ n: string }>(opened, 'abc', sealed)).n).toBe('x')
    await expect(openWithPassword(config, root, 'wrong password!')).rejects.toBeInstanceOf(WrongPasswordError)
    // Another account's root key can't open it, even with the right password
    await expect(openWithPassword(config, await rootKey(), PW)).rejects.not.toBeInstanceOf(WrongPasswordError)
  })

  it('stores the hint sealed with the root key', async () => {
    const root = await rootKey()
    const { config } = await createVault(root, PW, ' the usual ', FAST)
    expect(config.h).toBeDefined()
    expect(JSON.stringify(config)).not.toContain('the usual')
    expect(await readHint(config, root)).toBe('the usual')
    expect(await readHint(config, await rootKey())).toBeNull()
  })

  it('recovers with the code: new password, new code, the old code stops working', async () => {
    const root = await rootKey()
    const { config, key, code } = await createVault(root, PW, '', FAST)
    const sealed = await sealItem(key, 'abc', { n: 'x' })
    expect(await checkRecoveryCode(config, root, code)).toBe(true)
    await expect(recover(config, root, newRecoveryCode(), 'new password 123')).rejects.toBeInstanceOf(WrongCodeError)
    await expect(recover(config, root, 'not a code', 'new password 123')).rejects.toBeInstanceOf(WrongCodeError)

    const after = await recover(config, root, code, 'new password 123')
    expect(after.code).not.toBe(code)
    expect((await unsealItem<{ n: string }>(after.key, 'abc', sealed)).n).toBe('x')
    expect(await checkRecoveryCode(after.config, root, code)).toBe(false)
    expect(await checkRecoveryCode(after.config, root, after.code)).toBe(true)
    await expect(openWithPassword(after.config, root, PW)).rejects.toBeInstanceOf(WrongPasswordError)
    await roundTrip(await openWithPassword(after.config, root, 'new password 123'))
  }, 20_000)

  it('changes the password without touching items; the code keeps working', async () => {
    const root = await rootKey()
    const { config, key, code } = await createVault(root, PW, '', FAST)
    await expect(changePassword(config, root, 'wrong', 'x')).rejects.toBeInstanceOf(WrongPasswordError)
    const next = await changePassword(config, root, PW, 'another long password')
    const sealed = await sealItem(key, 'abc', { n: 'x' })
    expect((await unsealItem<{ n: string }>(await openWithPassword(next, root, 'another long password'), 'abc', sealed)).n).toBe('x')
    expect(await checkRecoveryCode(next, root, code)).toBe(true)
  }, 20_000)

  it('makes a new recovery code (the old one stops working)', async () => {
    const root = await rootKey()
    const { config, code } = await createVault(root, PW, '', FAST)
    await expect(newCode(config, root, 'wrong')).rejects.toBeInstanceOf(WrongPasswordError)
    const next = await newCode(config, root, PW)
    expect(await checkRecoveryCode(next.config, root, code)).toBe(false)
    expect(await checkRecoveryCode(next.config, root, next.code)).toBe(true)
  }, 20_000)
})

describe('items', () => {
  it('round-trips, compressed and padded to 256 bytes', async () => {
    const key = await importAes(randomBytes(32))
    const short = await sealItem(key, 'a1', { n: 'Wi-Fi' })
    const long = await sealItem(key, 'a1', { n: 'Notes', t: 'lorem ipsum '.repeat(200) })
    // base64 of 12 (IV) + 256·k + 16 (tag)
    expect(atob(short).length).toBe(12 + 256 + 16)
    expect((atob(long).length - 28) % 256).toBe(0)
    expect((await unsealItem<{ t: string }>(key, 'a1', long)).t).toBe('lorem ipsum '.repeat(200))
  })

  it('is tied to its ID: moved to another message it fails', async () => {
    const key = await importAes(randomBytes(32))
    const sealed = await sealItem(key, 'a1', { n: 'Bank' })
    await expect(unsealItem(key, 'b2', sealed)).rejects.toBeInstanceOf(DamagedItemError)
  })

  it('detects changes and other keys', async () => {
    const key = await importAes(randomBytes(32))
    const sealed = await sealItem(key, 'a1', { n: 'Bank' })
    const bytes = Uint8Array.from(atob(sealed), (c) => c.charCodeAt(0))
    bytes[40] ^= 1
    await expect(unsealItem(key, 'a1', btoa(String.fromCharCode(...bytes)))).rejects.toBeInstanceOf(DamagedItemError)
    await expect(unsealItem(await importAes(randomBytes(32)), 'a1', sealed)).rejects.toBeInstanceOf(DamagedItemError)
  })
})
