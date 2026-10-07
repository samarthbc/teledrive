// Development only: TeleWarden without Telegram. `?mock&vault` starts at the first-run screen; `&vault=locked` has
// example items and is locked (master password below); `&vault=open` has them and is open; `&vault=pin` is locked
// with the PIN 4821 set. Everything runs through
// the real crypto and store, with the messages kept in memory (vault/memoryBackend.ts).
import { importAes, randomBytes } from '../drive/crypto'
import { configureVault, feedVault, useVault } from '../store/useVault'
import type { VaultFolder, VaultItem } from '../vault/items'
import { memoryBackend } from '../vault/memoryBackend'

export const MOCK_MASTER_PASSWORD = 'plum-river-otter-42-lantern'

const DAY = 86_400
const now = Math.floor(Date.now() / 1000)
const ago = (days: number) => now - days * DAY

const folders: VaultFolder[] = [
  { id: 'bank', n: 'Banking', rd: 0 },
  { id: 'work', n: 'Work', rd: 0 },
  { id: 'shop', n: 'Shopping', rd: 0 },
  { id: 'social', n: 'Social', rd: 0 },
]

const items: VaultItem[] = [
  {
    id: 'google', ty: 'login', n: 'Google', fav: true, rd: 1, ct: ago(600), pc: ago(95),
    d: { u: 'sam@example.com', p: 'Rk7#vLq2!mZp9xWe', otp: 'JBSWY3DPEHPK3PXP', urls: [{ u: 'https://accounts.google.com' }] },
    notes: 'Recovery codes are in the note “Google recovery codes”.',
    ph: [{ p: 'Gm@il2023!', d: ago(200) }, { p: 'sammy1234', d: ago(640) }],
  },
  { id: 'amazon', ty: 'login', n: 'Amazon', f: 'shop', rd: 1, ct: ago(900), pc: ago(210), d: { u: 'sam@example.com', p: 'amazon123', urls: [{ u: 'https://www.amazon.in' }] } },
  { id: 'netflix', ty: 'login', n: 'Netflix', rd: 1, ct: ago(2000), pc: ago(640), d: { u: 'sam@example.com', p: 'sunshine2019', urls: [{ u: 'https://www.netflix.com' }] } },
  {
    id: 'github', ty: 'login', n: 'GitHub', f: 'work', fav: true, rd: 1, ct: ago(1500), pc: ago(40),
    d: { u: 'samb-dev', p: 'v9$Qe2#Lm8!tYr4Kp', otp: 'GEZDGNBVGY3TQOJQ', urls: [{ u: 'https://github.com' }] },
    cf: [{ k: 'Recovery email', v: 'sam@example.com' }],
  },
  {
    id: 'hdfcnet', ty: 'login', n: 'HDFC NetBanking', f: 'bank', rd: 1, ct: ago(1900), pc: ago(120),
    d: { u: '48210937', p: 'Tq!7mW#2xLp9@Vn', urls: [{ u: 'https://netbanking.hdfcbank.com' }] },
    cf: [{ k: 'Transaction PIN', v: '4821', h: true }],
  },
  {
    id: 'insta', ty: 'login', n: 'Instagram', f: 'social', rd: 1, ct: ago(1400), pc: ago(300),
    d: { u: 'sam_b', p: 'amazon123', urls: [{ u: 'https://www.instagram.com' }, { u: 'androidapp://com.instagram.android' }] },
  },
  { id: 'router', ty: 'login', n: 'Home router', rd: 1, ct: ago(508), pc: ago(508), d: { u: 'admin', p: 'Router@2021', urls: [{ u: 'http://192.168.1.1' }] } },
  { id: 'slack', ty: 'login', n: 'Slack', f: 'work', rd: 1, ct: ago(800), pc: ago(420), d: { u: 'sam@company.example', p: 'Hn4$kP9!zQ2wLx7e', urls: [{ u: 'https://app.slack.com' }] } },
  { id: 'visa', ty: 'card', n: 'HDFC Visa', f: 'bank', fav: true, rd: 1, ct: ago(900), d: { h: 'SAM B', num: '4532778109344421', exp: '08/29', cvv: '312' } },
  { id: 'master', ty: 'card', n: 'ICICI Mastercard', f: 'bank', rd: 1, ct: ago(1000), d: { h: 'SAM B', num: '5412750012349087', exp: '11/27', cvv: '908' } },
  {
    id: 'me', ty: 'identity', n: 'Personal', rd: 1, ct: ago(700),
    d: {
      ti: 'Mr', fn: 'Sam', ln: 'B', em: 'sam@example.com', ph: '+91 98450 12345', a1: '12 MG Road', city: 'Bengaluru', st: 'Karnataka', pin: '560001',
      ctry: 'India', aad: '234567890123', pan: 'ABCDE1234F', pp: 'Z1234567',
    },
  },
  { id: 'codes', ty: 'note', n: 'Google recovery codes', f: 'bank', rd: 1, ct: ago(600), d: { t: '4821 9930   1177 2045\n6630 1182   9054 7710\n3391 5528   0846 2273' } },
  { id: 'wifi', ty: 'note', n: 'Home Wi-Fi', rd: 1, ct: ago(508), d: { t: 'Network: Home-5G\nPassword: plum-river-otter-42\nGuest: Home-Guest / visit-2026' } },
  { id: 'yahoo', ty: 'login', n: 'Yahoo (old)', tr: ago(6), rd: 1, ct: ago(4000), d: { u: 'sam.b@example.com', p: 'yahoo2015', urls: [{ u: 'https://login.yahoo.com' }] } },
]

export async function startVaultMock(mode: string): Promise<void> {
  const root = await importAes(randomBytes(32))
  const mem = memoryBackend(feedVault)
  configureVault({ backend: mem.backend, rootKey: () => root, drive: () => ({}) as never })
  mem.emit()
  if (mode !== 'locked' && mode !== 'open' && mode !== 'pin') return
  const vault = useVault.getState()
  await vault.create(MOCK_MASTER_PASSWORD, 'the fruit, the river, the animal, a number, a light')
  useVault.setState({ pendingCode: null })
  for (const f of folders) await vault.saveFolder(f)
  for (const i of items) await vault.save(i)
  if (mode === 'pin') await vault.setPin(MOCK_MASTER_PASSWORD, '4821')
  if (mode === 'locked' || mode === 'pin') vault.lock()
}
