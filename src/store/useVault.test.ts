import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importAes, randomBytes, WrongPasswordError } from '../drive/crypto'
import type { VaultItemMeta } from '../drive/meta'
import { blankItem, type LoginItem } from '../vault/items'
import { memoryBackend } from '../vault/memoryBackend'
import { DamagedItemError } from '../vault/vaultCrypto'

vi.mock('./useDrive', () => ({ useDrive: { getState: () => ({ drive: {} }) } }))
vi.mock('../drive/vault', () => ({ verifyPassword: async (p: string) => p === 'teledrive pw' }))
vi.mock('../vault/backend', () => ({ telegramBackend: {} }))
vi.mock('../drive/sync', () => ({ subscribe: () => () => {} }))

const { useVault, configureVault, feedVault, ConflictError } = await import('./useVault')

const PW = 'plum river otter 42 lantern'
let mem: ReturnType<typeof memoryBackend>
let root: CryptoKey

const login = (id: string, n: string, p = 'secret'): LoginItem => ({ ...(blankItem('login', id) as LoginItem), n, d: { u: 'sam', p, urls: [] } })
const settle = () => new Promise((r) => setTimeout(r, 30))
const vault = () => useVault.getState()

beforeEach(async () => {
  vault().lock()
  root = await importAes(randomBytes(32))
  mem = memoryBackend(feedVault)
  configureVault({ backend: mem.backend, rootKey: () => root, drive: () => ({}) as never })
  mem.emit()
  await settle()
  useVault.setState({ tries: 0, waitUntil: 0 })
})

describe('TeleWarden store', () => {
  it('creates, locks and unlocks; wrong passwords count toward a wait', async () => {
    expect(vault().status).toBe('none')
    const code = await vault().create(PW, 'the usual')
    expect(code).toMatch(/^(\w{4}-){7}\w{4}$/)
    expect(vault().status).toBe('open')
    expect(await vault().readHint()).toBe('the usual')
    vault().lock()
    expect(vault().status).toBe('locked')
    for (let i = 0; i < 5; i++) await expect(vault().unlock('nope nope nope')).rejects.toBeInstanceOf(WrongPasswordError)
    expect(vault().waitUntil).toBeGreaterThan(Date.now())
    await expect(vault().unlock(PW)).rejects.toThrow(/Too many/)
    useVault.setState({ waitUntil: 0 })
    await vault().unlock(PW)
    expect(vault().status).toBe('open')
    expect(vault().tries).toBe(0)
  }, 30_000)

  it('saves items sealed (nothing readable in the channel) and reads them back after a lock', async () => {
    await vault().create(PW, '')
    await vault().save(login('a1', 'Bank'))
    await settle()
    expect(vault().items.map((i) => i.n)).toEqual(['Bank'])
    expect(JSON.stringify(mem.records())).not.toMatch(/Bank|secret|login/)
    vault().lock()
    expect(vault().items).toEqual([])
    await vault().unlock(PW)
    expect(vault().items.map((i) => i.n)).toEqual(['Bank'])
  }, 30_000)

  it('keeps password history and refuses an edit made from an older revision', async () => {
    await vault().create(PW, '')
    const saved = await vault().save(login('a1', 'Bank', 'one'))
    await settle()
    const edited = await vault().save({ ...saved, d: { ...(saved as LoginItem).d, p: 'two' } } as LoginItem, saved.rd)
    await settle()
    expect((vault().items[0] as LoginItem).ph?.map((h) => h.p)).toEqual(['one'])
    // Another device saved meanwhile: editing from `saved` (older) conflicts
    await expect(vault().save({ ...saved, n: 'Mine' }, saved.rd)).rejects.toBeInstanceOf(ConflictError)
    await vault().save({ ...edited, n: 'Renamed' }, edited.rd)
    await settle()
    expect(vault().items[0].n).toBe('Renamed')
  }, 30_000)

  it('trash, restore, empty trash, and purges trash older than 30 days on open', async () => {
    await vault().create(PW, '')
    await vault().save(login('a1', 'Old'))
    await vault().save(login('a2', 'Keep'))
    await settle()
    await vault().trash(['a1', 'a2'])
    await settle()
    expect(vault().items.every((i) => i.tr)).toBe(true)
    await vault().restore(['a2'])
    await settle()
    // Make a1's trash date 31 days old, then reopen
    const a1 = vault().items.find((i) => i.id === 'a1')!
    await vault().save({ ...a1, tr: Math.floor(Date.now() / 1000) - 31 * 86_400 })
    vault().lock()
    await vault().unlock(PW)
    await settle()
    expect(vault().items.map((i) => i.n)).toEqual(['Keep'])
  }, 30_000)

  it('notices an item swapped onto another message, and an old version coming back', async () => {
    await vault().create(PW, '')
    await vault().save(login('a1', 'Bank'))
    await vault().save(login('a2', 'Mail'))
    await settle()
    const before = mem.records()
    const a2 = before.find((r) => r.meta.t === 'v' && r.meta.id === 'a2')!
    const a1 = before.find((r) => r.meta.t === 'v' && r.meta.id === 'a1')!
    // Someone with access to the channel copies a2's ciphertext onto a1's message
    mem.replace(before.map((r) => (r === a1 ? { ...r, meta: { ...(a1.meta as VaultItemMeta), e: (a2.meta as VaultItemMeta).e } } : r)))
    await settle()
    expect(vault().damaged).toBe(1)
    expect(DamagedItemError).toBeDefined()
    // Put the original back, save a newer version, then roll back to the original
    mem.replace(before)
    await settle()
    const item = vault().items.find((i) => i.id === 'a1')!
    await vault().save({ ...item, n: 'Bank 2' })
    await settle()
    mem.replace(before)
    await settle()
    expect(vault().rollbacks).toEqual(['a1'])
    vault().acceptRollback('a1')
    expect(vault().rollbacks).toEqual([])
  }, 30_000)

  it('recovers with the code, changes the password, makes a new code, resets', async () => {
    const code = await vault().create(PW, '')
    await vault().save(login('a1', 'Bank'))
    vault().lock()
    expect(await vault().checkCode('0000-0000-0000-0000-0000-0000-0000-0000')).toBe(false)
    expect(await vault().checkCode(code)).toBe(true)
    const code2 = await vault().recover(code, 'brand new master password')
    expect(code2).not.toBe(code)
    expect(vault().status).toBe('open')
    await settle()
    expect(vault().items.map((i) => i.n)).toEqual(['Bank'])
    await vault().changePassword('brand new master password', 'and another one please')
    const code3 = await vault().newCode('and another one please')
    expect(await vault().checkCode(code2)).toBe(false)
    expect(await vault().checkCode(code3)).toBe(true)
    await expect(vault().reset('wrong')).rejects.toBeInstanceOf(WrongPasswordError)
    await vault().reset('teledrive pw')
    await settle()
    expect(vault().status).toBe('none')
    expect(mem.records().filter((r) => r.meta.t !== 'cfg')).toEqual([])
  }, 60_000)

  it('folders: deleting one moves its items out', async () => {
    await vault().create(PW, '')
    await vault().saveFolder({ id: 'f1', n: 'Banking', rd: 0 })
    await settle()
    await expect(vault().saveFolder({ id: 'f2', n: 'banking', rd: 0 })).rejects.toThrow(/already exists/)
    await vault().save({ ...login('a1', 'Bank'), f: 'f1' })
    await settle()
    await vault().deleteFolder('f1')
    await settle()
    expect(vault().folders).toEqual([])
    expect(vault().items[0].f).toBeUndefined()
  }, 30_000)
})
