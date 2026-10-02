// Login phone number as two fields: country calling code and the number itself.

// Every country calling code (ITU E.164). They're prefix-free, so a full number starts with at most one of them.
const CODES = new Set(
  ('1 7 20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 ' +
    '86 90 91 92 93 94 95 98 211 212 213 216 218 220 221 222 223 224 225 226 227 228 229 230 231 232 233 234 235 236 ' +
    '237 238 239 240 241 242 243 244 245 246 248 249 250 251 252 253 254 255 256 257 258 260 261 262 263 264 265 266 ' +
    '267 268 269 290 291 297 298 299 350 351 352 353 354 355 356 357 358 359 370 371 372 373 374 375 376 377 378 380 ' +
    '381 382 383 385 386 387 389 420 421 423 500 501 502 503 504 505 506 507 508 509 590 591 592 593 594 595 596 597 ' +
    '598 599 670 672 673 674 675 676 677 678 679 680 681 682 683 685 686 687 688 689 690 691 692 850 852 853 855 856 ' +
    '880 886 960 961 962 963 964 965 966 967 968 970 971 972 973 974 975 976 977 992 993 994 995 996 998').split(' '),
)

/** A full international number ("+91 98765 43210", "0091…") as code and number; null if it isn't one. */
export function splitPhone(text: string): { code: string; number: string } | null {
  const trimmed = text.trim()
  if (!/^(\+|00)/.test(trimmed)) return null
  const digits = trimmed.replace(/^00/, '').replace(/\D/g, '')
  for (let n = 1; n <= 3; n++) {
    const code = digits.slice(0, n)
    if (CODES.has(code)) return { code, number: digits.slice(n) }
  }
  return null
}

/** The number Telegram gets: "+<code><number>", digits only. */
export const fullPhone = (code: string, number: string) => `+${code}${number.replace(/\D/g, '')}`

export const isCountryCode = (code: string) => CODES.has(code)

const SAVED = 'teledrive.countryCode'

// Common regions, for a first guess (the person can change it)
const BY_REGION: Record<string, string> = {
  IN: '91', US: '1', CA: '1', GB: '44', DE: '49', FR: '33', ES: '34', IT: '39', NL: '31', PL: '48', RU: '7', UA: '380',
  TR: '90', IR: '98', BR: '55', MX: '52', AR: '54', CO: '57', ID: '62', PH: '63', VN: '84', MY: '60', SG: '65',
  PK: '92', BD: '880', LK: '94', NP: '977', AE: '971', SA: '966', EG: '20', NG: '234', KE: '254', ZA: '27',
  AU: '61', NZ: '64', JP: '81', KR: '82', CN: '86', KZ: '7', UZ: '998',
}

/** The code used last on this device, else a guess from the time zone or language, else none. */
export function guessCountryCode(): string {
  try {
    const saved = localStorage.getItem(SAVED)
    if (saved && CODES.has(saved)) return saved
  } catch {
    // Storage blocked: guess
  }
  // Many phones in India report en-US, so the time zone comes first there
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (zone === 'Asia/Kolkata' || zone === 'Asia/Calcutta') return '91'
  const region = navigator.language.split('-')[1]?.toUpperCase()
  return (region && BY_REGION[region]) ?? ''
}

export function rememberCountryCode(code: string) {
  try {
    localStorage.setItem(SAVED, code)
  } catch {
    // Fine: we'll guess again next time
  }
}
