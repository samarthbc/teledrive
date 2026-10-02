import { describe, expect, it } from 'vitest'
import { fullPhone, splitPhone } from './phone'

describe('phone numbers', () => {
  it('splits a full international number into code and number', () => {
    expect(splitPhone('+91 98765 43210')).toEqual({ code: '91', number: '9876543210' })
    expect(splitPhone('+1 (415) 555-0100')).toEqual({ code: '1', number: '4155550100' })
    expect(splitPhone('+380 67 123 4567')).toEqual({ code: '380', number: '671234567' })
    expect(splitPhone('0044 7700 900123')).toEqual({ code: '44', number: '7700900123' })
  })

  it('leaves a number without a country code alone', () => {
    expect(splitPhone('98765 43210')).toBeNull()
    expect(splitPhone('+')).toBeNull()
  })

  it('joins them for Telegram', () => {
    expect(fullPhone('91', '98765 43210')).toBe('+919876543210')
  })
})
