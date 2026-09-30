import { createSHA256 } from 'hash-wasm'
import type { TransferControl } from './transfer'
import type { ByteSource } from './upload'

const SLICE = 4 * 1024 * 1024

/** SHA-256 of a file (hex), read in slices so large files don't fill memory. */
export async function sha256(src: ByteSource, ctl?: TransferControl, onProgress?: (done: number) => void): Promise<string> {
  const hasher = await createSHA256()
  hasher.init()
  for (let offset = 0; offset < src.size; offset += SLICE) {
    await ctl?.checkpoint()
    hasher.update(new Uint8Array(await src.slice(offset, offset + SLICE).arrayBuffer()))
    onProgress?.(Math.min(src.size, offset + SLICE))
  }
  return hasher.digest('hex')
}
