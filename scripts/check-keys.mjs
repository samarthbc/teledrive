// Fails if your Telegram api_hash is inside a build that will be published.
// node scripts/check-keys.mjs <file or folder>...
//
// The hash is read from .env (on your PC) or the KEY_CHECK_HASH environment variable (CI). With
// neither, there's no key to leak: public builds also ignore .env (see vite.config.ts).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const fromEnvFile = existsSync('.env') ? /^\s*VITE_TG_API_HASH\s*=\s*["']?([0-9a-f]{32})/im.exec(readFileSync('.env', 'utf8'))?.[1] : undefined
const hash = (process.env.KEY_CHECK_HASH || fromEnvFile || '').toLowerCase()
const targets = process.argv.slice(2)

if (!targets.length) {
  console.error('Usage: node scripts/check-keys.mjs <file or folder>...')
  process.exit(2)
}
if (!hash) {
  console.log('check-keys: no api_hash known here (no .env / KEY_CHECK_HASH), nothing to look for')
  process.exit(0)
}

const needles = [Buffer.from(hash), Buffer.from(hash.toUpperCase())]
const found = []
let files = 0

function scan(path) {
  const st = statSync(path)
  if (st.isDirectory()) return readdirSync(path).forEach((n) => scan(join(path, n)))
  files++
  const bytes = readFileSync(path)
  if (needles.some((n) => bytes.includes(n))) found.push(path)
}
targets.forEach(scan)

if (found.length) {
  console.error(`check-keys: your api_hash is in ${found.length} file(s). Don't publish this build:`)
  for (const f of found) console.error('  ' + f)
  process.exit(1)
}
console.log(`check-keys: no API key in ${files} files`)
