import { createFolder } from './ops'
import type { Drive } from './tree'

/** A file picked or dropped as part of a folder, with the folders above it (relative to what was picked). */
export interface TreeFile {
  file: File
  dirs: string[]
}

export interface PickedTree {
  files: TreeFile[]
  /** Every folder, including empty ones (as path segments). */
  folders: string[][]
}

/** From `<input webkitdirectory>`: each file has a path like "Photos/2026/a.jpg". */
export function treeFromInput(files: File[]): PickedTree {
  const out: TreeFile[] = files.map((file) => {
    const segments = (file.webkitRelativePath || file.name).split('/').filter(Boolean)
    return { file, dirs: segments.slice(0, -1) }
  })
  return { files: out, folders: foldersOf(out.map((f) => f.dirs)) }
}

/**
 * From a drop: walks dropped folders. Must be called synchronously in the drop handler
 * (the browser only allows reading the dropped items during the event).
 */
export function treeFromDrop(items: DataTransferItemList): Promise<PickedTree> {
  const entries = Array.from(items)
    .filter((i) => i.kind === 'file')
    .map((i) => i.webkitGetAsEntry())
    .filter((e): e is FileSystemEntry => !!e)
  return (async () => {
    const files: TreeFile[] = []
    const dirs: string[][] = []
    const walk = async (entry: FileSystemEntry, path: string[]) => {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
        files.push({ file, dirs: path })
      } else if (entry.isDirectory) {
        const here = [...path, entry.name]
        dirs.push(here)
        for (const child of await readAll(entry as FileSystemDirectoryEntry)) await walk(child, here)
      }
    }
    for (const e of entries) await walk(e, [])
    return { files, folders: foldersOf([...dirs, ...files.map((f) => f.dirs)]) }
  })()
}

/** A directory reader returns entries in batches; read until it's empty. */
async function readAll(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader()
  const all: FileSystemEntry[] = []
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (!batch.length) return all
    all.push(...batch)
  }
}

/** Every folder path and its parents, parents first. */
function foldersOf(paths: string[][]): string[][] {
  const seen = new Map<string, string[]>()
  for (const p of paths) for (let i = 1; i <= p.length; i++) seen.set(p.slice(0, i).join('/'), p.slice(0, i))
  return [...seen.values()].sort((a, b) => a.length - b.length)
}

/**
 * Create the folders inside `parentId`. Returns the new folder ID for each path ("a/b").
 * Top-level folders get a new name if one with the same name already exists ("Photos (1)").
 */
export async function createFolders(
  getDrive: () => Drive, parentId: string, folders: string[][], onProgress?: (done: number) => void,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>()
  for (const [i, path] of folders.entries()) {
    const parent = path.length === 1 ? parentId : ids.get(path.slice(0, -1).join('/'))!
    ids.set(path.join('/'), await createFolder(getDrive(), parent, path[path.length - 1]))
    onProgress?.(i + 1)
  }
  return ids
}
