import { create } from 'zustand'
import { isAndroid, Native, PhoneFile } from './android'

/** Files shared to the app ("Share → TeleDrive") waiting for the user to pick a folder. */
export const useIncomingShares = create<{ files: PhoneFile[]; clear: () => void }>((set) => ({
  files: [],
  clear: () => set({ files: [] }),
}))

async function collect() {
  const { files } = await Native.takeSharedFiles()
  if (!files.length) return
  useIncomingShares.setState((s) => ({ files: [...s.files, ...files.map((f) => new PhoneFile(f))] }))
}

export function initShareReceiver(): void {
  if (!isAndroid) return
  void Native.addListener('shared', () => void collect())
  void collect() // app opened by a share
}
