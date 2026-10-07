import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { SaveTarget } from '../drive/download'
import type { ByteSource, UploadSource } from '../drive/upload'

/** The hidden backup page run while the app is closed (see HeadlessRunner.java). */
const headlessBridge = (window as unknown as { TeleDriveHeadless?: { call(method: string, args: string): string } }).TeleDriveHeadless
export const isHeadless = !!headlessBridge

/** True inside the Android app, including the background backup page (false on the website). */
export const isAndroid = Capacitor.getPlatform() === 'android' || isHeadless

export interface PhoneFileInfo {
  uri: string
  name: string
  size: number
  mime: string
  lastModified: number
}

export interface CameraItem extends PhoneFileInfo {
  id: string
  /** Unix seconds. */
  dateAdded: number
  /** When it was taken (unix ms), if the photo library knows. */
  dateTaken?: number
  /** Size in pixels as stored, and the rotation to show it with (0/90/180/270). */
  width?: number
  height?: number
  orientation?: number
  /** Folder (MediaStore relative path, e.g. "DCIM/Camera/"). */
  path: string
}

export interface MediaFolder {
  /** MediaStore relative path, e.g. "DCIM/Screenshots/". */
  path: string
  count: number
  /** The newest photo/video in it (for a thumbnail). */
  sampleUri: string
}

/** Native side: android/app/src/main/java/.../TeleDriveNativePlugin.java */
interface TeleDriveNativePlugin {
  mediaPermission(o: { request?: boolean }): Promise<{ granted: boolean }>
  notificationPermission(): Promise<{ granted: boolean }>
  createFile(o: { name: string; mime: string; location: 'downloads' | 'cache' }): Promise<{ id: string }>
  appendFile(o: { id: string; data: string }): Promise<void>
  finishFile(o: { id: string }): Promise<{ uri: string }>
  abortFile(o: { id: string }): Promise<void>
  openFile(o: { uri: string; mime: string }): Promise<void>
  takeSharedFiles(): Promise<{ files: PhoneFileInfo[] }>
  readFile(o: { uri: string; offset: number; length: number }): Promise<{ data: string }>
  closeFile(o: { uri: string }): Promise<void>
  thumbnail(o: { uri: string }): Promise<{ data?: string }>
  listMedia(o: { paths: string[]; since: number; limit?: number }): Promise<{ items: CameraItem[] }>
  listMediaFolders(): Promise<{ folders: MediaFolder[] }>
  /** Move photos/videos to the phone's trash (Android asks first). `done`: the user allowed it. Android 11+. */
  trashMedia(o: { uris: string[] }): Promise<{ done: boolean }>
  scheduleBackgroundBackup(o: { enabled: boolean; wifiOnly: boolean; instant: boolean; overnight: boolean; charging: boolean }): Promise<void>
  backgroundBackupStatus(): Promise<{ lastRun: number; lastResult: string }>
  backgroundBackupDone(o: { result: string }): Promise<void>
  openAppSettings(): Promise<void>
  /** Status/navigation bar colours for the app's theme. */
  systemBars(o: { dark: boolean }): Promise<void>
  /** TeleWarden: copy marked sensitive, cleared after `clearAfter` seconds (0 = never) if still on the clipboard. */
  copySecret(o: { text: string; clearAfter: number }): Promise<void>
  /** TeleWarden: scan a QR code (Google's scanner). */
  scanQr(): Promise<{ text?: string; cancelled?: boolean }>
  /** Background backup page only. */
  network(): Promise<{ connected: boolean; wifi: boolean }>
  done(o: { result: string }): Promise<void>
  log(o: { message: string }): Promise<void>
  keepAlive(o: { title: string; text: string; progress: number }): Promise<void>
  stopKeepAlive(): Promise<void>
  addListener(event: 'shared', fn: () => void): Promise<PluginListenerHandle>
  /** Android's background job, with the app running: `scope` "all" for the nightly run. */
  addListener(event: 'backgroundBackup', fn: (e?: { scope?: string }) => void): Promise<PluginListenerHandle>
  /** App updates from GitHub Releases. */
  downloadUpdate(o: { version: string; size: number; sha256?: string }): Promise<void>
  installUpdate(): Promise<{ needsPermission: boolean }>
  clearUpdate(): Promise<void>
  addListener(event: 'updateProgress', fn: (e: { progress: number }) => void): Promise<PluginListenerHandle>
}

/** In the background backup page, the same calls go through a plain WebView bridge. */
function headlessNative(bridge: NonNullable<typeof headlessBridge>): TeleDriveNativePlugin {
  return new Proxy({} as TeleDriveNativePlugin, {
    get: (_, method: string) => async (args?: object) => {
      const res = JSON.parse(bridge.call(method, JSON.stringify(args ?? {})))
      if (res.error) throw new Error(res.error)
      return res
    },
  })
}

export const Native: TeleDriveNativePlugin = headlessBridge
  ? headlessNative(headlessBridge)
  : registerPlugin<TeleDriveNativePlugin>('TeleDriveNative')

// ---- base64 (the plugin bridge only carries strings) ----

export async function toBase64(bytes: Uint8Array): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(new Blob([bytes as BlobPart]))
  })
  return url.slice(url.indexOf(',') + 1)
}

export async function fromBase64(data: string): Promise<ArrayBuffer> {
  return (await fetch(`data:application/octet-stream;base64,${data}`)).arrayBuffer()
}

// ---- Files on the phone, readable in slices (for uploading) ----

class PhoneSlice implements ByteSource {
  constructor(
    protected uri: string,
    protected start: number,
    readonly size: number,
  ) {}

  slice(start = 0, end = this.size): ByteSource {
    const s = Math.max(0, Math.min(start, this.size))
    const e = Math.max(s, Math.min(end, this.size))
    return new PhoneSlice(this.uri, this.start + s, e - s)
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    if (this.size === 0) return new ArrayBuffer(0)
    const { data } = await Native.readFile({ uri: this.uri, offset: this.start, length: this.size })
    const bytes = await fromBase64(data)
    // Never upload a short or misplaced read as if it were the real data
    if (bytes.byteLength !== this.size)
      throw new Error(`Could not read the file (got ${bytes.byteLength} of ${this.size} bytes at ${this.start})`)
    return bytes
  }
}

/** A photo, video or shared file on the phone, uploadable like a browser File. */
export class PhoneFile extends PhoneSlice implements UploadSource {
  readonly name: string
  readonly type: string
  readonly lastModified: number
  readonly taken?: number
  readonly width?: number
  readonly height?: number

  constructor(info: PhoneFileInfo | CameraItem) {
    super(info.uri, 0, info.size)
    this.name = info.name
    this.type = info.mime
    this.lastModified = info.lastModified
    if ('dateTaken' in info && info.dateTaken) this.taken = Math.floor(info.dateTaken / 1000)
    if ('width' in info && info.width && info.height) {
      const turned = info.orientation === 90 || info.orientation === 270
      this.width = turned ? info.height : info.width
      this.height = turned ? info.width : info.height
    }
  }

  async thumbnail(): Promise<Blob | null> {
    if (!this.type.startsWith('image/') && !this.type.startsWith('video/')) return null
    const { data } = await Native.thumbnail({ uri: this.uri })
    return data ? new Blob([await fromBase64(data)], { type: 'image/jpeg' }) : null
  }
}

// ---- Saving downloads ----

export interface PhoneSaveTarget extends SaveTarget {
  /** content:// URI of the saved file, set once it's finished. */
  uri?: string
}

/** Write a download into Downloads/TeleDrive ("downloads") or the cache ("cache", for Open with…). */
export function phoneSaveTarget(name: string, mime: string, location: 'downloads' | 'cache'): PhoneSaveTarget {
  let id: Promise<string> | null = null
  const open = () => (id ??= Native.createFile({ name, mime, location }).then((r) => r.id))
  const target: PhoneSaveTarget = {
    write: async (chunk) => Native.appendFile({ id: await open(), data: await toBase64(chunk) }),
    close: async () => {
      target.uri = (await Native.finishFile({ id: await open() })).uri
    },
    abort: async () => {
      if (id) await Native.abortFile({ id: await id })
    },
  }
  return target
}

export function openWithOtherApp(uri: string, mime: string): Promise<void> {
  return Native.openFile({ uri, mime })
}
