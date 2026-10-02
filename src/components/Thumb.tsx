import { Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { hasThumbnail, thumbnailUrl } from '../drive/thumbs'
import type { Item } from '../drive/tree'
import { category, fileIcon } from '../lib/format'
import { useSettings } from '../lib/settings'

/**
 * Thumbnail if the file has one (loaded when scrolled into view), otherwise a file-type icon. With thumbnails
 * off in Settings, always the icon (nothing is downloaded).
 */
export default function Thumb({ item, iconClass }: { item: Item; iconClass: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const enabled = useSettings((s) => s.thumbnails)
  const canLoad = enabled && item.kind === 'file' && hasThumbnail(item)

  useEffect(() => {
    setUrl(null)
    const el = ref.current
    if (!canLoad || !el || item.kind !== 'file') return
    let alive = true
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        observer.disconnect()
        thumbnailUrl(item).then((u) => alive && setUrl(u))
      },
      { rootMargin: '200px' },
    )
    observer.observe(el)
    return () => {
      alive = false
      observer.disconnect()
    }
  }, [item, canLoad])

  const { Icon, color } = fileIcon(item)
  return (
    <div ref={ref} className="relative flex h-full w-full items-center justify-center overflow-hidden">
      {url ? (
        <img src={url} alt="" draggable={false} className="h-full w-full object-cover" />
      ) : (
        <Icon className={`${iconClass} ${color}`} strokeWidth={1.6} />
      )}
      {url && category(item) === 'video' && (
        <span className="absolute flex size-8 items-center justify-center rounded-full bg-black/55 text-white">
          <Play className="h-4 w-4 fill-current" />
        </span>
      )}
    </div>
  )
}
