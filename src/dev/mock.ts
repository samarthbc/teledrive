// Development only: `?mock` shows the app with sample files and no Telegram connection, for
// working on the design and taking screenshots. `?mock=password|login|setup` shows that screen.
// Loaded from main.tsx only when import.meta.env.DEV, so it never ships.
import type { Meta } from '../drive/meta'
import type { Transfer } from '../drive/queue'
import { buildDrive, type MessageRecord } from '../drive/tree'
import { useBackup } from '../native/backup'
import { useDrive, type Phase } from '../store/useDrive'

const DAY = 86_400
const now = Math.floor(Date.now() / 1000)
const lock = { s: 'mock', i: 'mock', w: 'mock' }

const folders: [string, string, string, number, Record<string, unknown>?][] = [
  ['docs', 'root', 'Documents', 1],
  ['photos', 'root', 'Camera', 2],
  ['projects', 'root', 'Projects', 6],
  ['locked', 'root', '', 3, { l: lock, x: { enc: 1 }, e: 'sealed' }],
  ['taxes', 'docs', 'Taxes 2026', 9],
]
const files: [string, string, string, number, string, number, Record<string, unknown>?][] = [
  ['deck', 'root', 'Pitch deck final.pptx', 12_600_000, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 0.1, { x: { fav: 1 } }],
  ['coorg', 'root', 'Trip to Coorg.mp4', 1_400_000_000, 'video/mp4', 0.2],
  ['resume', 'root', 'Resume 2026.pdf', 182_000, 'application/pdf', 3],
  ['budget', 'root', 'Budget.xlsx', 48_000, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 5],
  ['img1', 'root', 'IMG_2041.jpg', 3_200_000, 'image/jpeg', 6],
  ['voice', 'root', 'Voice note 12.m4a', 2_100_000, 'audio/mp4', 7],
  ['notes', 'root', 'notes.txt', 4_000, 'text/plain', 8],
  ['secret', 'root', '', 52_000, 'application/pdf', 4, { l: lock, x: { enc: 1 }, e: 'sealed' }],
  ['itr', 'docs', 'ITR acknowledgement.pdf', 240_000, 'application/pdf', 10],
  ['old', 'root', 'Old backup.zip', 210_000_000, 'application/zip', 20, { x: { tr: now - 2 * DAY } }],
  ['draft', 'root', 'Draft notes.txt', 3_000, 'text/plain', 12, { x: { tr: now - 5 * DAY } }],
  ...Array.from({ length: 9 }, (_, i) => [`cam${i}`, 'photos', `IMG_20${41 + i}.jpg`, 2_900_000 + i * 50_000, 'image/jpeg', 0.3 + i] as const),
] as never

function records(): MessageRecord[] {
  let msgId = 1
  const out: MessageRecord[] = []
  for (const [id, p, n, age, extra] of folders)
    out.push({ msgId: msgId++, date: now - age * DAY, meta: { td: 1, t: 'd', id, p, n, ts: now - age * DAY, ...extra } as Meta })
  for (const [id, p, n, s, m, age, extra] of files) {
    const of = s > 2_000_000_000 ? 2 : 1
    out.push({ msgId: msgId++, date: now - age * DAY, meta: { td: 1, t: 'f', id, p, n, s, m, of, ts: Math.floor(now - age * DAY), ...extra } as Meta })
  }
  return out
}

const transfers: Transfer[] = [
  { id: 't1', kind: 'upload', name: 'Trip to Coorg.mp4', size: 1_400_000_000, done: 612_000_000, status: 'running', speed: 3_100_000 },
  { id: 't2', kind: 'upload', name: 'Budget.xlsx', size: 48_000, done: 0, status: 'running', speed: 0, note: 'Checking file…' },
]

const param = new URLSearchParams(location.search)
const screen = param.get('mock') || 'drive'
const phase: Phase = (['password', 'login', 'setup'] as const).find((p) => p === screen) ?? 'ready'

useDrive.setState({
  phase,
  passwordMode: param.get('create') !== null ? 'create' : 'enter',
  // Only the root level is open, so the sample locked items show as locked
  drive: buildDrive(records(), { isOpen: (level) => level === 'root', secretOf: () => undefined }),
  drives: [
    { id: '1', accessHash: '0', title: 'TeleDrive Storage' },
    { id: '2', accessHash: '0', title: 'TeleDrive · Work' },
  ] as never,
  currentDrive: '1',
  transfers: param.has('transfers') ? transfers : [],
  boot: async () => {},
  refresh: async () => {},
  submitPassword: async () => {},
})
// `&app` shows the Android-only parts (camera backup); see DrivePage
useBackup.setState({ settings: { enabled: true, wifiOnly: true, since: 0 }, status: param.get('backup') ?? 'Up to date' })
