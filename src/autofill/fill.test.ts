import { describe, expect, it } from 'vitest'
import { blankItem, type CardItem, type IdentityItem, type LoginItem } from '../vault/items'
import { formType, parseKinds, valuesFor } from './fill'

describe('autofill values', () => {
  it('reads the field list Android sends, ignoring unknown names', () => {
    expect(parseKinds('username,password,bogus')).toEqual(['username', 'password'])
    expect(parseKinds(null)).toEqual([])
  })

  it('tells login, card and address forms apart', () => {
    expect(formType(['password'])).toBe('login')
    expect(formType(['ccNumber', 'ccCvc', 'name'])).toBe('card')
    expect(formType(['name', 'postal'])).toBe('identity')
  })

  it('fills a login', () => {
    const l = { ...(blankItem('login', 'a') as LoginItem), d: { u: 'sam', p: 'pw', urls: [] } }
    expect(valuesFor(l, ['username', 'password'])).toEqual({ username: 'sam', password: 'pw' })
    expect(valuesFor(l, ['password'])).toEqual({ password: 'pw' })
  })

  it('fills a card, splitting the expiry for separate month and year fields', () => {
    const c = { ...(blankItem('card', 'c') as CardItem), d: { h: 'SAM B', num: '4532 7781 0934 4421', exp: '8/29', cvv: '312' } }
    expect(valuesFor(c, ['ccNumber', 'ccName', 'ccExp', 'ccExpMonth', 'ccExpYear', 'ccCvc'])).toEqual({
      ccNumber: '4532778109344421', ccName: 'SAM B', ccExp: '08/29', ccExpMonth: '08', ccExpYear: '2029', ccCvc: '312',
    })
  })

  it('fills an address form, leaving out what the identity lacks', () => {
    const i = { ...(blankItem('identity', 'i') as IdentityItem), d: { fn: 'Sam', ln: 'B', a1: '12 MG Road', a2: 'Indiranagar', city: 'Bengaluru', pin: '560001' } }
    expect(valuesFor(i, ['name', 'address', 'city', 'postal', 'phone'])).toEqual({
      name: 'Sam B', address: '12 MG Road, Indiranagar', city: 'Bengaluru', postal: '560001',
    })
  })
})
