// TeleDrive service worker: lets <video>/<audio> stream files straight from Telegram.
//
// Media elements request "<base>/stream/<fileId>/<name>" with a Range header. This worker asks the
// page that made the request for those bytes (the page holds the Telegram connection) and answers
// with a 206 Partial Content response, so seeking works without downloading the whole file.

const REPLY_TIMEOUT = 60_000

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return
  const match = url.pathname.match(/\/stream\/([^/]+)/)
  if (!match) return
  event.respondWith(handleStream(event, decodeURIComponent(match[1])))
})

async function handleStream(event, id) {
  const client = await findClient(event)
  if (!client) return new Response('TeleDrive is not open', { status: 503 })

  const range = /bytes=(\d+)-(\d*)/.exec(event.request.headers.get('Range') || '')
  const start = range ? Number(range[1]) : 0
  const end = range && range[2] ? Number(range[2]) : undefined

  const reply = await ask(client, { type: 'td-stream', id, start, end })
  if (!reply.ok) return new Response(reply.error || 'Stream failed', { status: reply.status || 500 })

  const { bytes, size, mime } = reply
  const last = reply.start + bytes.byteLength - 1
  return new Response(bytes, {
    status: 206,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(bytes.byteLength),
      'Content-Range': `bytes ${reply.start}-${last}/${size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    },
  })
}

async function findClient(event) {
  if (event.clientId) {
    const client = await self.clients.get(event.clientId)
    if (client) return client
  }
  const all = await self.clients.matchAll({ type: 'window' })
  return all.find((c) => c.focused) || all[0]
}

function ask(client, message) {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve({ ok: false, error: 'Timed out', status: 504 }), REPLY_TIMEOUT)
    channel.port1.onmessage = (e) => {
      clearTimeout(timer)
      resolve(e.data)
    }
    client.postMessage(message, [channel.port2])
  })
}
