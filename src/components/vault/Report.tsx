import { ChevronRight, Clock, Copy, KeyRound, Loader2, ShieldCheck, ShieldAlert, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useVault } from '../../store/useVault'
import type { VaultItem } from '../../vault/items'
import { ageOf, buildReport, OLD_DAYS, type Problem, type Report } from '../../vault/report'
import { loadStrength } from '../../vault/strength'
import { Warning } from './parts'

// The security report (IMPLEMENTATION.md → "Phase 22"): the page, the warnings on a login, the badges in the list.

export const PROBLEM_INFO: Record<Problem, { title: string; hint: string; badge: string; icon: LucideIcon }> = {
  reused: { title: 'Reused passwords', hint: 'One leak opens every login that shares it.', badge: 'Reused', icon: Copy },
  weak: { title: 'Weak passwords', hint: 'Easy to guess or crack.', badge: 'Weak', icon: KeyRound },
  old: { title: 'Not changed in over a year', hint: `Same password for more than ${OLD_DAYS} days.`, badge: 'Old', icon: Clock },
}

/** One report per list of items (the store makes a new list on every change). */
const cache = new WeakMap<VaultItem[], Report>()

/** The report for the open vault, or null while the strength checker loads. */
export function useReport(): Report | null {
  const items = useVault((s) => s.items)
  const [score, setScore] = useState<Awaited<ReturnType<typeof loadStrength>> | null>(null)
  useEffect(() => {
    let live = true
    void loadStrength().then((check) => live && setScore(() => check))
    return () => {
      live = false
    }
  }, [])
  if (!score) return null
  let report = cache.get(items)
  if (!report) cache.set(items, (report = buildReport(items, score, Math.floor(Date.now() / 1000))))
  return report
}

export function ReportPanel({ onOpen }: { onOpen: (p: Problem) => void }) {
  const report = useReport()
  const logins = useVault((s) => s.items.filter((i) => i.ty === 'login' && !i.tr).length)
  if (!report)
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-7 animate-spin text-brand-ink" />
      </div>
    )
  const good = report.total === 0
  return (
    <div className="grid gap-4.5">
      <div className="panel flex items-center gap-4 p-5 md:p-6">
        <span className={`flex size-14 shrink-0 items-center justify-center rounded-md ${good ? 'text-ink raised-sm' : 'bg-brand text-white raised-sm'}`}>
          {good ? <ShieldCheck className="size-7" /> : <ShieldAlert className="size-7" />}
        </span>
        <div className="min-w-0">
          <p className="text-xl leading-tight font-black tracking-[-0.02em]">
            {good ? 'All your logins look fine' : `${report.total} login${report.total === 1 ? '' : 's'} need${report.total === 1 ? 's' : ''} attention`}
          </p>
          <p className="mt-1 text-[13px] text-muted">
            {logins} login{logins === 1 ? '' : 's'} checked on this device. Nothing is sent anywhere.
          </p>
        </div>
      </div>
      <div className="grid gap-4.5 md:grid-cols-3">
        {(['reused', 'weak', 'old'] as Problem[]).map((p) => {
          const { title, hint, icon: Icon } = PROBLEM_INFO[p]
          const n = report.counts[p]
          return (
            <button
              type="button"
              key={p}
              className="panel flex w-full items-center gap-3.5 p-4 text-left disabled:cursor-default enabled:active:pressed md:flex-col md:items-start md:gap-3 md:p-5"
              disabled={!n}
              onClick={() => onOpen(p)}
            >
              <span className="flex w-auto items-center md:w-full">
                <span className={`flex size-10 shrink-0 items-center justify-center rounded-md raised-sm ${n ? 'text-brand-ink' : 'text-muted'}`}>
                  <Icon className="size-5" />
                </span>
                <span className={`ml-auto hidden text-[34px] leading-none font-black tabular-nums md:block ${n ? 'text-brand-ink' : 'text-muted'}`}>{n}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-bold">{title}</span>
                <span className="block text-[13px] text-muted">{hint}</span>
              </span>
              <span className={`text-2xl font-black tabular-nums md:hidden ${n ? 'text-brand-ink' : 'text-muted'}`}>{n}</span>
              {n > 0 && <ChevronRight className="size-5 shrink-0 text-muted md:hidden" />}
              {n > 0 && <span className="hidden text-[13px] font-bold text-brand-ink md:inline">Show {n === 1 ? 'it' : `all ${n}`} →</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** On a login: one warning per problem, and Change password. */
export function ReportWarnings({ item, onChangePassword, onOpen }: { item: VaultItem; onChangePassword: () => void; onOpen: (id: string) => void }) {
  const report = useReport()
  const items = useVault((s) => s.items)
  const problems = report?.problems.get(item.id)
  if (!problems || item.ty !== 'login') return null
  const others = (report!.sharedWith.get(item.id) ?? []).map((id) => items.find((i) => i.id === id)).filter((i): i is VaultItem => !!i)
  const age = Math.floor(Date.now() / 1000) - (item.pc ?? item.ct)
  return (
    <Warning>
      {problems.map((p) => (
        <span key={p} className="block">
          {p === 'reused' ? (
            <>
              <b>Reused</b> on {others.length === 1 ? '' : `${others.length} other logins: `}
              {others.map((o, i) => (
                <span key={o.id}>
                  {i ? ', ' : ''}
                  <button type="button" className="font-semibold underline decoration-line underline-offset-2 hover:text-brand-ink" onClick={() => onOpen(o.id)}>
                    {o.n}
                  </button>
                </span>
              ))}
            </>
          ) : p === 'weak' ? (
            <>
              <b>Weak password.</b> Easy to guess.
            </>
          ) : (
            <>
              <b>Not changed</b> for {ageOf(age)}.
            </>
          )}
        </span>
      ))}
      <span className="mt-2.5 flex">
        <button type="button" className="btn-secondary h-9" onClick={onChangePassword}>
          <KeyRound /> Change password
        </button>
      </span>
    </Warning>
  )
}

/** The most serious problem, as a small badge in the list (reused and weak only). */
export function ReportBadge({ item }: { item: VaultItem }) {
  const report = useReport()
  const first = report?.problems.get(item.id)?.[0]
  if (!first || first === 'old') return null
  return (
    <span className="shrink-0 rounded-md border-[1.5px] border-brand-ink px-1.5 py-px text-[10.5px] font-extrabold tracking-[0.08em] text-brand-ink uppercase">
      {PROBLEM_INFO[first].badge}
    </span>
  )
}
