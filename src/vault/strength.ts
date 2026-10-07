import { useEffect, useState } from 'react'

// Password strength with zxcvbn (knows common passwords, names, keyboard patterns and l33t speak), loaded only when
// TeleWarden needs it. See IMPLEMENTATION.md → "Phase 19.3" (the master password rule) and "19.6".

export type Score = 0 | 1 | 2 | 3 | 4
export const SCORE_LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'] as const

/** The master password: at least this long and rated at least Strong. */
export const MASTER_MIN_LENGTH = 12
export const MASTER_MIN_SCORE: Score = 3

type Check = (password: string, userInputs?: string[]) => Score

let loading: Promise<Check> | null = null
let loaded: Check | null = null

export function loadStrength(): Promise<Check> {
  loading ??= Promise.all([import('@zxcvbn-ts/core'), import('@zxcvbn-ts/language-common')]).then(([core, common]) => {
    const z = new core.ZxcvbnFactory({ dictionary: { ...common.dictionary }, graphs: common.adjacencyGraphs })
    loaded = (password, userInputs = []) => z.check(password.slice(0, 256), userInputs).score as Score
    return loaded
  })
  return loading
}

/** The score, or null while zxcvbn loads (and for an empty password). */
export function useStrength(password: string, userInputs?: string[]): Score | null {
  const [, setReady] = useState(!!loaded)
  useEffect(() => {
    if (!loaded) void loadStrength().then(() => setReady(true))
  }, [])
  return password && loaded ? loaded(password, userInputs) : null
}

export interface Rule {
  label: string
  ok: boolean
}

/**
 * The master password's rules, as the checklist under it. `notTeleDrive` is checked separately (it takes a moment):
 * null while unknown.
 */
export function masterRules(password: string, repeat: string, score: Score | null, notTeleDrive: boolean | null): Rule[] {
  return [
    { label: `At least ${MASTER_MIN_LENGTH} characters`, ok: password.length >= MASTER_MIN_LENGTH },
    { label: 'Rated Strong or Very strong', ok: score !== null && score >= MASTER_MIN_SCORE },
    { label: 'Not your TeleDrive password', ok: !!password && notTeleDrive === true },
    { label: 'Both entries match', ok: !!password && password === repeat },
  ]
}
