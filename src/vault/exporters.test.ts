import { describe, expect, it } from 'vitest'
import { WrongPasswordError } from '../drive/crypto'
import { isProtected, protect, toBitwardenJson, toCsv, unprotect } from './exporters'
import { importFile } from './importers'
import type { CardItem, IdentityItem, LoginItem, NoteItem, VaultFolder, VaultItem } from './items'

const folders: VaultFolder[] = [{ id: 'f1', n: 'Bank', rd: 1 }]
const items: VaultItem[] = [
  { id: 'a', ty: 'login', n: 'HDFC', f: 'f1', fav: true, rd: 1, ct: 1, cf: [{ k: 'PIN', v: '4821', h: true }], d: { u: 'sam', p: 'p, "q"', otp: 'JBSWY3DPEHPK3PXP', urls: [{ u: 'https://hdfc.example' }] } } as LoginItem,
  { id: 'b', ty: 'note', n: 'Wi-Fi', rd: 1, ct: 1, d: { t: 'line 1\nline 2' } } as NoteItem,
  { id: 'c', ty: 'card', n: 'Visa', rd: 1, ct: 1, d: { h: 'SAM', num: '4111111111111111', exp: '08/29', cvv: '123' } } as CardItem,
  { id: 'd', ty: 'identity', n: 'Me', rd: 1, ct: 1, d: { fn: 'Sam', pan: 'ABCDE1234F', pin: '560001' } } as IdentityItem,
  { id: 'e', ty: 'login', n: 'Old', tr: 5, rd: 1, ct: 1, d: { u: '', p: '', urls: [] } } as LoginItem,
]
const strip = (list: VaultItem[]) => list.map(({ id: _i, ct: _c, rd: _r, f: _f, ...rest }) => rest)

describe('export', () => {
  it('JSON comes back through the Bitwarden importer (trash left out)', () => {
    const back = importFile('bitwarden-json', JSON.stringify(toBitwardenJson(items, folders)))
    expect(back.folders).toEqual(['Bank'])
    expect(back.items).toHaveLength(4)
    expect(back.items[0].f).toBe('Bank')
    expect(strip(back.items)).toEqual(strip(items.slice(0, 4)))
  })

  it('CSV comes back through the Bitwarden CSV importer (logins and notes)', () => {
    const back = importFile('bitwarden-csv', toCsv(items, folders))
    expect(back.items.map((i) => i.n)).toEqual(['HDFC', 'Wi-Fi'])
    expect(back.items[0]).toMatchObject({ f: 'Bank', fav: true, d: { p: 'p, "q"', otp: 'JBSWY3DPEHPK3PXP' } })
    expect((back.items[1] as NoteItem).d.t).toBe('line 1\nline 2')
  })

  it('password-protected: round trip, wrong password refused, nothing readable', async () => {
    const json = JSON.stringify(toBitwardenJson(items, folders))
    const file = await protect(json, 'file password 1', 1000)
    expect(isProtected(file)).toBe(true)
    expect(file).not.toContain('HDFC')
    expect(await unprotect(file, 'file password 1')).toBe(json)
    await expect(unprotect(file, 'nope')).rejects.toBeInstanceOf(WrongPasswordError)
  })
})
