/** The TeleDrive mark: a white paper plane on a red square (same drawing as the app icons). */
export default function Logo({ className = 'size-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={`shrink-0 rounded-md raised-sm ${className}`} role="img" aria-label="TeleDrive">
      <rect width="32" height="32" rx="6" fill="var(--red)" />
      <path d="M7 16.5 24 9l-3 15-5.5-4.5-3 3v-4.5L21 12l-10 6.5z" fill="#fff" />
    </svg>
  )
}
