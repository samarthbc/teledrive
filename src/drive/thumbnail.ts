/** Telegram document thumbnails: JPEG, at most 320 px per side and 200 KB. */
const MAX_SIDE = 320
const MAX_BYTES = 200 * 1024
const MAX_IMAGE_SOURCE = 60 * 1024 * 1024
const VIDEO_TIMEOUT = 8000

/** Make a small JPEG preview for images and videos. Returns null if the browser can't decode the file. */
export async function makeThumbnail(file: Blob, mime: string): Promise<Blob | null> {
  try {
    if (mime.startsWith('image/') && file.size <= MAX_IMAGE_SOURCE) return await imageThumb(file)
    if (mime.startsWith('video/')) return await videoThumb(file)
  } catch {
    // Unsupported format (e.g. HEIC in most browsers): upload without a thumbnail
  }
  return null
}

async function imageThumb(file: Blob): Promise<Blob | null> {
  const bitmap = await createImageBitmap(file)
  try {
    return await toJpeg(bitmap, bitmap.width, bitmap.height)
  } finally {
    bitmap.close()
  }
}

function videoThumb(file: Blob): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    const done = (result: Blob | null) => {
      clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
      resolve(result)
    }
    const timer = setTimeout(() => done(null), VIDEO_TIMEOUT)
    video.muted = true
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      // A frame a little way in is usually more representative than the first (often black) one
      video.currentTime = Math.min(1, (video.duration || 0) / 3)
    }
    video.onseeked = () => {
      toJpeg(video, video.videoWidth, video.videoHeight).then(done, () => done(null))
    }
    video.onerror = () => done(null)
    video.src = url
  })
}

async function toJpeg(source: CanvasImageSource, width: number, height: number): Promise<Blob | null> {
  if (!width || !height) return null
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#fff' // transparent PNGs would otherwise turn black
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  for (const quality of [0.8, 0.6, 0.4]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality))
    if (blob && blob.size <= MAX_BYTES) return blob
  }
  return null
}
