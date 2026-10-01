import { Bookmark, Loader2, Search, Send } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { FileItem } from '../../drive/tree'
import { describeError } from '../../telegram/auth'
import { enqueue } from '../../drive/queue'
import { listChats, searchPeople, sendFile, type Chat } from '../../telegram/share'
import { toast } from '../../store/useToast'
import Dialog from '../Dialog'

let cachedChats: Chat[] | null = null

/** Pick a Telegram chat and send files to it. */
export default function SendDialog({ files, onClose }: { files: FileItem[]; onClose: () => void }) {
  const [chats, setChats] = useState<Chat[] | null>(cachedChats)
  const [found, setFound] = useState<Chat[]>([])
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<Chat | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listChats().then(
      (c) => {
        cachedChats = c
        setChats(c)
      },
      (e) => setError(describeError(e)),
    )
  }, [])

  // Also look up people by name or @username (debounced)
  useEffect(() => {
    const q = query.trim().replace(/^@/, '')
    if (q.length < 3) return setFound([])
    const timer = setTimeout(() => {
      searchPeople(q).then(setFound, () => setFound([]))
    }, 400)
    return () => clearTimeout(timer)
  }, [query])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^@/, '')
    const local = (chats ?? []).filter((c) => !q || c.title.toLowerCase().includes(q) || c.subtitle.toLowerCase().includes(q))
    const keys = new Set(local.map((c) => c.key))
    return [...local, ...found.filter((c) => !keys.has(c.key))]
  }, [chats, found, query])

  const what = files.length === 1 ? `“${files[0].name}”` : `${files.length} files`

  // Each file is decrypted and uploaded into the chat, with progress in the transfers panel
  const send = () => {
    if (!chosen) return
    const to = chosen
    files.forEach((f, i) =>
      enqueue('upload', `${f.name} → ${to.title}`, f.size, (ctl) => sendFile(to.peer, f, i === 0 ? message.trim() : '', ctl)),
    )
    toast(`Sending ${what} to ${to.title}`)
    onClose()
  }

  return (
    <Dialog
      title={`Send ${what}`}
      icon={Send}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!chosen} onClick={send}>
            <Send />
            Send{chosen ? ` to ${chosen.title}` : ''}
          </button>
        </>
      }
    >
      <div className="space-y-3 pb-2 text-sm">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-[17px] -translate-y-1/2 text-muted" />
          <input className="input pl-10.5" aria-label="Search chats" autoFocus placeholder="Search chats or @username" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <ul className="max-h-72 space-y-1 overflow-y-auto rounded-md p-1.5 pressed">
          {!chats && !error && (
            <li className="flex justify-center py-6">
              <Loader2 className="size-5 animate-spin text-muted" />
            </li>
          )}
          {chats && !shown.length && <li className="py-6 text-center text-muted">No chats found</li>}
          {shown.map((c) => (
            <li key={c.key}>
              <button
                className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left ${chosen?.key === c.key ? 'bg-surface raised-sm' : 'hover:pressed-xs'}`}
                aria-pressed={chosen?.key === c.key}
                onClick={() => setChosen(c)}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-[13px] font-extrabold raised-xs">
                  {c.key === 'self' ? <Bookmark className="size-4" /> : initials(c.title)}
                </span>
                <span className="min-w-0">
                  <span className={`block truncate font-bold ${chosen?.key === c.key ? 'text-brand-ink' : ''}`}>{c.title}</span>
                  <span className="block truncate text-xs text-muted">{c.subtitle}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {chosen && (
          <input className="input" aria-label="Message" placeholder="Add a message (optional)" value={message} onChange={(e) => setMessage(e.target.value)} />
        )}
        {error && <p className="font-semibold text-brand-ink">{error}</p>}
      </div>
    </Dialog>
  )
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/)
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '?'
}
