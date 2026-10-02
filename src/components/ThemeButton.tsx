import { Moon, Sun, SunMoon } from 'lucide-react'
import { cycleTheme, THEME_LABELS, useTheme } from '../lib/theme'

const ICONS = { system: SunMoon, light: Sun, dark: Moon }

/** The theme switch: System → Light → Dark (DESIGN.md §2). */
export default function ThemeButton({ className = '' }: { className?: string }) {
  const mode = useTheme((t) => t.mode)
  const Icon = ICONS[mode]
  return (
    <button className={`icon-btn ${className}`} onClick={cycleTheme} aria-label={THEME_LABELS[mode]} title={THEME_LABELS[mode]}>
      <Icon />
    </button>
  )
}
