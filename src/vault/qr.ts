import { isAndroid, isHeadless, Native } from '../native/android'

// Reading QR codes (IMPLEMENTATION.md → "Phase 20.2"): the camera through Google's scanner in the Android app;
// an image or a pasted screenshot everywhere (ZXing, with jsQR as a fallback, loaded only then). The website can't use the camera (its
// Permissions-Policy turns it off).

export const canScanWithCamera = isAndroid && !isHeadless

/** The QR code's text, or null if the scan was cancelled. */
export async function scanWithCamera(): Promise<string | null> {
  const res = await Native.scanQr()
  return res.cancelled ? null : (res.text ?? null)
}

/** The text of the QR code in an image, or null if there's none. */
export async function readQrFromImage(file: Blob): Promise<string | null> {
  const image = await imageData(file, 3000)
  if (!image) return null
  // ZXing first: it reads photos of a screen, blur, tilt and dense codes (Google Authenticator's exports) that
  // jsQR often misses. jsQR at a few sizes if ZXing finds nothing or can't load.
  try {
    const text = await readWithZxing(image)
    if (text) return text
  } catch (e) {
    console.warn('ZXing failed, trying jsQR', e)
  }
  const { default: jsQR } = await import('jsqr')
  for (const size of [image.width, 1600, 1000, 700]) {
    const img = size >= Math.max(image.width, image.height) ? image : await imageData(file, size)
    const found = img && jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })
    if (found?.data) return found.data
  }
  return null
}

/** The image's pixels, scaled down to at most `max` pixels on its longer side. */
async function imageData(file: Blob, max: number): Promise<ImageData | null> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return ctx.getImageData(0, 0, w, h)
}

let zxingReady: Promise<typeof import('zxing-wasm/reader')> | null = null

/** ZXing's reader (WebAssembly bundled with the app, loaded the first time it's needed). */
async function readWithZxing(image: ImageData): Promise<string | null> {
  zxingReady ??= (async () => {
    const [zxing, { default: wasmUrl }] = await Promise.all([import('zxing-wasm/reader'), import('zxing-wasm/reader/zxing_reader.wasm?url')])
    await zxing.prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) }, fireImmediately: true })
    return zxing
  })().catch((e) => {
    zxingReady = null
    throw e
  })
  const zxing = await zxingReady
  const [found] = await zxing.readBarcodes(image, { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1 })
  return found?.text || null
}

/** An image pasted with Ctrl+V (a screenshot), if there is one. */
export function pastedImage(e: React.ClipboardEvent | ClipboardEvent): File | null {
  for (const item of e.clipboardData?.items ?? []) if (item.type.startsWith('image/')) return item.getAsFile()
  return null
}
