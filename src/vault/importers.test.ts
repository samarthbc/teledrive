import { describe, expect, it } from 'vitest'
import { importFile, isDuplicate, parseCsv } from './importers'
import type { CardItem, IdentityItem, LoginItem, NoteItem } from './items'

describe('CSV', () => {
  it('handles quotes, commas, newlines and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi""\nthere"\n\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"\nthere']])
  })
})

describe('importers', () => {
  it('Chrome / Edge', () => {
    const r = importFile('chrome', 'name,url,username,password,note\nGitHub,https://github.com/login,sam,pw1,hello\n,https://x.example,u,p,')
    const [a, b] = r.items as LoginItem[]
    expect(a).toMatchObject({ n: 'GitHub', ty: 'login', notes: 'hello', d: { u: 'sam', p: 'pw1', urls: [{ u: 'https://github.com/login' }] } })
    expect(b.n).toBe('x.example')
    expect(() => importFile('chrome', 'foo,bar\n1,2')).toThrow(/Chrome/)
  })

  it('Firefox', () => {
    const r = importFile('firefox', '"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"\n"https://a.example","me","pw","","","{1}","1","1","1"')
    expect(r.items[0]).toMatchObject({ n: 'a.example', d: { u: 'me', p: 'pw' } })
  })

  it('LastPass: folders, favorites, secure notes, TOTP', () => {
    const r = importFile('lastpass', 'url,username,password,totp,extra,name,grouping,fav\nhttps://bank.example,sam,pw,JBSWY3DPEHPK3PXP,note,Bank,Money,1\nhttp://sn,,,,"Wi-Fi: x",Home Wi-Fi,,0')
    const [bank, wifi] = r.items
    expect(bank).toMatchObject({ n: 'Bank', f: 'Money', fav: true, notes: 'note', d: { otp: 'JBSWY3DPEHPK3PXP' } })
    expect(wifi).toMatchObject({ ty: 'note', n: 'Home Wi-Fi', d: { t: 'Wi-Fi: x' } })
    expect(r.folders).toEqual(['Money'])
  })

  it('1Password CSV', () => {
    const r = importFile('1password', 'Title,Url,Username,Password,OTPAuth,Notes\nMail,https://mail.example,sam,pw,otpauth://totp/x?secret=JBSWY3DPEHPK3PXP,n')
    expect(r.items[0]).toMatchObject({ n: 'Mail', d: { u: 'sam', p: 'pw', otp: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP' }, notes: 'n' })
  })

  it('Bitwarden CSV', () => {
    const r = importFile('bitwarden-csv', 'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\nWork,1,login,Slack,,"PIN: 1234",0,"https://a.example,https://b.example",sam,pw,\n,,note,Codes,secret text,,0,,,,')
    expect(r.items[0]).toMatchObject({ n: 'Slack', f: 'Work', fav: true, cf: [{ k: 'PIN', v: '1234' }], d: { urls: [{ u: 'https://a.example' }, { u: 'https://b.example' }] } })
    expect(r.items[1]).toMatchObject({ ty: 'note', d: { t: 'secret text' } })
  })

  it('Bitwarden JSON: logins, notes, cards, identities, folders, hidden fields', () => {
    const json = {
      encrypted: false,
      folders: [{ id: 'f1', name: 'Bank' }],
      items: [
        { type: 1, name: 'HDFC', folderId: 'f1', favorite: true, fields: [{ name: 'PIN', value: '4821', type: 1 }], login: { username: 'u', password: 'p', totp: 'JBSWY3DPEHPK3PXP', uris: [{ uri: 'https://hdfc.example' }] } },
        { type: 2, name: 'Note', notes: 'text', secureNote: { type: 0 } },
        { type: 3, name: 'Visa', card: { cardholderName: 'SAM', number: '4111 1111 1111 1111', expMonth: '8', expYear: '2029', code: '123' } },
        { type: 4, name: 'Me', identity: { firstName: 'Sam', email: 'a@b.in', ssn: 'ABCDE1234F', postalCode: '560001' } },
      ],
    }
    const r = importFile('bitwarden-json', JSON.stringify(json))
    const [l, n, c, i] = r.items as [LoginItem, NoteItem, CardItem, IdentityItem]
    expect(l).toMatchObject({ f: 'Bank', fav: true, cf: [{ k: 'PIN', v: '4821', h: true }], d: { otp: 'JBSWY3DPEHPK3PXP' } })
    expect(n.d.t).toBe('text')
    expect(c.d).toEqual({ h: 'SAM', num: '4111111111111111', exp: '08/29', cvv: '123' })
    expect(i.d).toEqual({ fn: 'Sam', em: 'a@b.in', pan: 'ABCDE1234F', pin: '560001' })
    expect(r.folders).toEqual(['Bank'])
    expect(() => importFile('bitwarden-json', JSON.stringify({ encrypted: true }))).toThrow(/encrypted/)
  })

  it('finds duplicates', () => {
    const [a] = importFile('chrome', 'name,url,username,password\nGitHub,https://github.com,sam,x').items
    const [b] = importFile('chrome', 'name,url,username,password\ngithub,https://github.com/login,SAM,y').items
    expect(isDuplicate(b, [a])).toBe(true)
    expect(isDuplicate({ ...b, n: 'Other' }, [a])).toBe(false)
  })
})
