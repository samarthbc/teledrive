import { isAndroid, isHeadless, Native } from '../native/android'

// Reading QR codes (IMPLEMENTATION.md → "Phase 20.2"): the camera through Google's scanner in the Android app;
// an image or a pasted screenshot everywhere (jsQR, loaded only then). The website can't use the camera (its
// Permissions-Policy turns it off).

export const canScanWithCamera = isAndroid && !isHeadless

/** The QR code's text, or null if the scan was cancelled. */
export async function scanWithCamera(): Promise<string | null> {
  const res = await Native.scanQr()
  return res.cancelled ? null : (res.text ?? null)
}

/** The text of the QR code in an image, or null if there's none. */
export async function readQrFromImage(file: Blob): Promise<string | null> {
  const { default: jsQR } = await import('jsqr')
  const bitmap = await createImageBitmap(file)
  // Big screenshots: scaled down to keep it quick (QR codes stay readable)
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  const found = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' })
  return found?.data || null
}

/** An image pasted with Ctrl+V (a screenshot), if there is one. */
export function pastedImage(e: React.ClipboardEvent | ClipboardEvent): File | null {
  for (const item of e.clipboardData?.items ?? []) if (item.type.startsWith('image/')) return item.getAsFile()
  return null
}
