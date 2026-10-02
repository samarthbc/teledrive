import { describe, expect, it } from 'vitest'
import { parseKeys, validateKeys } from './config'

const HASH = '0123456789abcdef0123456789ABCDEF'

describe('parseKeys', () => {
  it('finds both keys in text copied from my.telegram.org', () => {
    expect(parseKeys(`App api_id:\n1234567\nApp api_hash:\n${HASH}`)).toEqual({ apiId: '1234567', apiHash: HASH.toLowerCase() })
  })
  it('finds one key alone', () => {
    expect(parseKeys(' 1234567 ')).toEqual({ apiId: '1234567', apiHash: undefined })
    expect(parseKeys(HASH)).toEqual({ apiId: undefined, apiHash: HASH.toLowerCase() })
  })
  it("doesn't take digits from inside the hash for the api_id", () => {
    expect(parseKeys('11112222333344445555666677778888').apiId).toBeUndefined()
  })
})

describe('validateKeys', () => {
  it('accepts well-formed keys and rejects others', () => {
    expect(validateKeys('1234567', HASH)).toBeNull()
    expect(validateKeys('12a', HASH)).toMatch(/number/)
    expect(validateKeys('1234567', 'xyz')).toMatch(/32/)
  })
})
