import bigInt from 'big-integer'

export class CanceledError extends Error {
  constructor() {
    super('Canceled')
  }
}

/** Lets the transfer queue pause, resume and cancel a running upload/download. */
export class TransferControl {
  private controller = new AbortController()
  private paused = false
  private resumeWaiters: (() => void)[] = []

  constructor(private onBytes: (n: number) => void) {}

  get canceled(): boolean {
    return this.controller.signal.aborted
  }

  get isPaused(): boolean {
    return this.paused
  }

  progress(bytes: number) {
    this.onBytes(bytes)
  }

  pause() {
    this.paused = true
  }

  resume() {
    this.paused = false
    for (const fn of this.resumeWaiters.splice(0)) fn()
  }

  cancel() {
    this.controller.abort()
    this.resume()
  }

  /** Call between network requests: throws if canceled, waits while paused. */
  async checkpoint(): Promise<void> {
    if (this.canceled) throw new CanceledError()
    while (this.paused) {
      await new Promise<void>((r) => this.resumeWaiters.push(r))
      if (this.canceled) throw new CanceledError()
    }
  }
}

export function randomLong(): bigInt.BigInteger {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  // Signed 64-bit range
  return bigInt(hex, 16).and(bigInt('7fffffffffffffff', 16))
}

/** Retry transient network failures (Telegram errors with a code are not retried, except timeouts). */
export async function withRetry<T>(fn: () => Promise<T>, ctl?: TransferControl, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (e) {
      const code = (e as { errorMessage?: string })?.errorMessage
      const retryable = !code || code === 'TIMEOUT' || code.startsWith('FLOOD_WAIT') || code === 'RPC_CALL_FAIL'
      if (!retryable || i >= attempts || ctl?.canceled) throw e
      const seconds = (e as { seconds?: number }).seconds
      await new Promise((r) => setTimeout(r, seconds ? seconds * 1000 : 1000 * 2 ** i))
      await ctl?.checkpoint()
    }
  }
}
