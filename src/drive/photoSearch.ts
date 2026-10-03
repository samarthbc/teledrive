import { ROOT } from './meta'
import type { Drive, FileItem } from './tree'

/**
 * TelePhotos search: find photos the way they're remembered. Every word must match one of
 * - a date: a year ("2024"), month ("dec", "December"), day of the month ("25", with a month), weekday ("sunday"),
 *   season ("summer"), or "today", "yesterday", "this/last week|month|year"
 * - what it is: "videos", "photos", "starred", "large"/"big", a file type ("png", "gif", "heic")
 * - where it came from: a top folder ("screenshots", "whatsapp"), an album's name
 * - or the file's name.
 * Dates are the date taken, in local time.
 */

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
/** Northern-hemisphere seasons (months, 0-based). */
const SEASONS: Record<string, number[]> = { spring: [2, 3, 4], summer: [5, 6, 7], autumn: [8, 9, 10], fall: [8, 9, 10], winter: [11, 0, 1] }
/** "Large": videos from 100 MB, photos from 10 MB. */
const LARGE_VIDEO = 100 * 1024 * 1024
const LARGE_PHOTO = 10 * 1024 * 1024

type Test = (f: FileItem, d: Date) => boolean

/** What a photo needs to match the search, worked out once per search. */
interface Context {
  /** Album IDs whose name contains the word. */
  albums: (word: string) => Set<string>
  folderName: (f: FileItem) => string
}

export function normalizeSearch(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

/** Photos (already in timeline order) that match the search. */
export function searchPhotos(drive: Drive, photos: FileItem[], query: string, now = new Date()): FileItem[] {
  const tests = parse(normalizeSearch(query), now)
  if (!tests.length) return []
  const folderOf = new Map<string, string>()
  const ctx: Context = {
    albums: (word) => new Set([...drive.albums.values()].filter((a) => normalizeSearch(a.name).includes(word)).map((a) => a.id)),
    folderName: (f) => {
      let name = folderOf.get(f.parent)
      if (name === undefined) {
        name = normalizeSearch(topFolderName(drive, f))
        folderOf.set(f.parent, name)
      }
      return name
    },
  }
  const compiled = tests.map((t) => t(ctx))
  return photos.filter((f) => {
    const d = new Date((f.taken || f.ts) * 1000)
    return compiled.every((t) => t(f, d))
  })
}

/** The name of the top folder a photo is in ("Camera", "Screenshots"), or "" if it's at the top. */
function topFolderName(drive: Drive, f: FileItem): string {
  let id = f.parent
  let name = ''
  for (let n = 0; n < 100 && id !== ROOT; n++) {
    const up = drive.items.get(id)
    if (!up) break
    name = up.name
    id = up.parent
  }
  return name
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const between = (from: Date, to: Date): Test => (_f, d) => d >= from && d < to

/** Phrases like "last month" become one word before splitting. */
function relative(q: string, now: Date): { rest: string; tests: Test[] } {
  const tests: Test[] = []
  const today = startOfDay(now)
  const add = (days: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + days)
  // Weeks start on Monday
  const weekStart = add(-((today.getDay() + 6) % 7))
  const ranges: Record<string, [Date, Date]> = {
    today: [today, add(1)],
    yesterday: [add(-1), today],
    'this week': [weekStart, add(1)],
    'last week': [new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() - 7), weekStart],
    'this month': [new Date(now.getFullYear(), now.getMonth(), 1), add(1)],
    'last month': [new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 1)],
    'this year': [new Date(now.getFullYear(), 0, 1), add(1)],
    'last year': [new Date(now.getFullYear() - 1, 0, 1), new Date(now.getFullYear(), 0, 1)],
  }
  let rest = q
  for (const [phrase, [from, to]] of Object.entries(ranges)) {
    const re = new RegExp(`(^|\\s)${phrase}(?=\\s|$)`, 'g')
    if (re.test(rest)) {
      tests.push(between(from, to))
      rest = rest.replace(re, ' ')
    }
  }
  // "last summer": the most recent one that has ended or is going on
  rest = rest.replace(/(^|\s)last (spring|summer|autumn|fall|winter)(?=\s|$)/g, (_m, _s, season: string) => {
    const months = SEASONS[season]
    let year = now.getFullYear()
    // Winter starts in December: the one that began last year
    const startMonth = months[0]
    if (startMonth > now.getMonth()) year--
    const from = new Date(year, startMonth, 1)
    const to = new Date(year, startMonth + 3, 1)
    tests.push(between(from, to))
    return ' '
  })
  return { rest, tests }
}

function parse(q: string, now: Date): ((ctx: Context) => Test)[] {
  const { rest, tests } = relative(q, now)
  const out: ((ctx: Context) => Test)[] = tests.map((t) => () => t)
  const words = rest.split(/\s+/).filter(Boolean)
  const hasMonth = words.some((w) => monthOf(w) >= 0)
  for (const w of words) out.push((ctx) => wordTest(w, hasMonth, ctx))
  return out
}

/** "dec", "december", "sept" → 11, 11, 8; otherwise -1. */
function monthOf(w: string): number {
  if (w.length < 3) return -1
  return MONTHS.findIndex((m) => m.startsWith(w) || (w === 'sept' && m === 'september'))
}

function dayOf(w: string): number {
  if (w.length < 3) return -1
  return DAYS.findIndex((d) => d.startsWith(w))
}

/** Plural or not: "videos" ~ "video", "screenshot" ~ "screenshots". */
function stem(w: string): string {
  return w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w
}

function wordTest(w: string, hasMonth: boolean, ctx: Context): Test {
  const tests: Test[] = []
  const s = stem(w)

  if (/^(19|20)\d\d$/.test(w)) tests.push((_f, d) => d.getFullYear() === Number(w))
  const month = monthOf(w)
  if (month >= 0) tests.push((_f, d) => d.getMonth() === month)
  // "25" means a day only next to a month ("25 dec"); "1st", "2nd" too
  const dayNum = /^(\d{1,2})(st|nd|rd|th)?$/.exec(w)
  if (dayNum && hasMonth) tests.push((_f, d) => d.getDate() === Number(dayNum[1]))
  const weekday = dayOf(w)
  if (weekday >= 0) tests.push((_f, d) => d.getDay() === weekday)
  if (SEASONS[w]) tests.push((_f, d) => SEASONS[w].includes(d.getMonth()))

  if (['video', 'movie', 'clip'].includes(s)) tests.push((f) => f.mime.startsWith('video/'))
  if (['photo', 'picture', 'pic', 'image', 'pics'].includes(s)) tests.push((f) => f.mime.startsWith('image/'))
  if (['starred', 'star', 'favorite', 'favourite', 'fav'].includes(s)) tests.push((f) => !!f.x.fav)
  if (['large', 'big', 'huge'].includes(w))
    tests.push((f) => f.size >= (f.mime.startsWith('video/') ? LARGE_VIDEO : LARGE_PHOTO))
  if (/^[a-z0-9]{3,4}$/.test(w)) {
    const ext = w === 'jpg' ? ['jpg', 'jpeg'] : [w]
    tests.push((f) => ext.some((e) => f.name.toLowerCase().endsWith(`.${e}`)) || f.mime === `image/${w}`)
  }

  // A year, or a day next to a month, is only a date ("dec 3" shouldn't match every name with a 3 in it)
  if (/^(19|20)\d\d$/.test(w) || (dayNum && hasMonth)) return (f, d) => tests.some((t) => t(f, d))

  const albums = ctx.albums(w)
  if (albums.size) tests.push((f) => !!f.albums?.some((a) => albums.has(a)))
  tests.push((f) => {
    const folder = ctx.folderName(f)
    return (!!folder && folder.includes(s)) || normalizeSearch(f.name).includes(w)
  })

  return (f, d) => tests.some((t) => t(f, d))
}
