import { Download, Monitor, Smartphone } from 'lucide-react'
import { formatBytes } from '../lib/format'
import { DOWNLOADS, downloadUrl, platformOrder, RELEASES_PAGE, useLatestRelease, type Platform } from '../lib/releases'

const ICONS: Record<Platform, typeof Monitor> = { windows: Monitor, android: Smartphone }

/** Download links for the Windows and Android apps (website only), the visitor's own system first. */
export default function GetApps({ className = '', heading = true }: { className?: string; heading?: boolean }) {
  const release = useLatestRelease()
  return (
    <section className={className} aria-label="Get the app">
      <div className="flex items-baseline justify-between gap-3">
        {heading && <h2 className="label-swiss">Get the app</h2>}
        {release && (
          <a href={RELEASES_PAGE} target="_blank" rel="noreferrer" className="text-xs font-semibold text-muted hover:text-ink">
            Version {release.version}
          </a>
        )}
      </div>
      <ul className={`space-y-2.5 ${heading || release ? 'mt-2.5' : ''}`}>
        {platformOrder().map((p) => {
          const Icon = ICONS[p]
          const { file, label, note } = DOWNLOADS[p]
          const size = release?.sizes[file]
          return (
            <li key={p} className="rounded-md p-3.5 pressed">
              <div className="flex items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface raised-xs">
                  <Icon className="size-5" strokeWidth={1.8} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-extrabold">{label}</span>
                  <span className="block truncate text-xs text-muted">
                    {file}
                    {size ? ` · ${formatBytes(size)}` : ''}
                  </span>
                </span>
                {release === null ? (
                  // Nothing published yet: no link to GitHub's "not found" page
                  <button className="btn-secondary h-10 shrink-0 px-3.5 text-sm" disabled>
                    Coming soon
                  </button>
                ) : (
                  <a className="btn-secondary h-10 shrink-0 px-3.5 text-sm" href={downloadUrl(p)} download aria-label={`Download for ${label}`}>
                    <Download /> Download
                  </a>
                )}
              </div>
              <p className="mt-2.5 text-xs leading-relaxed text-muted">{note}</p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
