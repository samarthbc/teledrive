import {
  ChevronDown, ChevronUp, Copy, CopyPlus, ExternalLink, FolderInput, History, MoreVertical, Pencil, RotateCcw, Star, StarOff, Trash2,
  TriangleAlert, UserRound,
} from 'lucide-react'
import { useState } from 'react'
import { formatDate } from '../../lib/format'
import { newVaultId, useVault } from '../../store/useVault'
import { toast, toastError } from '../../store/useToast'
import { copySecret } from '../../vault/clipboard'
import {
  cardBrand, fullName, groupCardNumber, hostOf, last4, maskAadhaar, openableUrl, subtitleOf, TRASH_DAYS, TYPE_NAMES, type VaultItem,
} from '../../vault/items'
import type { MenuEntry } from '../Menu'
import { useSettings } from '../../lib/settings'
import { OtpRow, RowCode } from './Otp'
import { FieldRow, ItemTile, SecretText, StrengthMeter } from './parts'

const nowSec = () => Math.floor(Date.now() / 1000)
const daysLeft = (tr: number) => Math.max(0, TRASH_DAYS - Math.floor((nowSec() - tr) / 86_400))

/** What the row's copy button copies. */
function quickCopy(item: VaultItem): [string, string] | null {
  switch (item.ty) {
    case 'login':
      return item.d.p ? [item.d.p, 'Password'] : item.d.u ? [item.d.u, 'Username'] : null
    case 'card':
      return item.d.num ? [item.d.num, 'Card number'] : null
    case 'identity':
      return item.d.em ? [item.d.em, 'Email'] : null
    case 'note':
      return item.d.t ? [item.d.t, 'Note'] : null
  }
}

export function ItemRow(props: { item: VaultItem; selected: boolean; onOpen: () => void }) {
  const { item, selected, onOpen } = props
  const copy = item.tr ? null : quickCopy(item)
  const codesInList = useSettings((s) => s.vaultCodesInList)
  const site = item.ty === 'login' ? item.d.urls.map((u) => openableUrl(u.u)).find(Boolean) : null
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}
      aria-current={selected || undefined}
      className={`group flex cursor-pointer items-center gap-3.5 rounded-md px-3 py-2.5 transition-[box-shadow] duration-120 ${selected ? 'pressed' : ''}`}
    >
      <ItemTile item={item} />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2 text-[15px] font-bold">
          <span className="truncate">{item.n}</span>
          {item.fav && <Star className="size-3.5 shrink-0 fill-brand-ink text-brand-ink" />}
          {item.tr ? (
            <span className="shrink-0 rounded-md border-[1.5px] border-brand-ink px-1.5 py-px text-[10.5px] font-extrabold tracking-[0.08em] text-brand-ink uppercase">
              {daysLeft(item.tr)}d left
            </span>
          ) : null}
        </p>
        <p className="truncate text-[13px] text-muted">{subtitleOf(item)}</p>
      </div>
      {codesInList && !item.tr && item.ty === 'login' && item.d.otp && <RowCode otp={item.d.otp} />}
      {copy && (
        <div className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
          {item.ty === 'login' && item.d.u && (
            <button className="icon-btn-flat hidden group-hover:inline-flex" onClick={() => void copySecret(item.d.u, 'Username')} aria-label="Copy username" title="Copy username">
              <UserRound />
            </button>
          )}
          {site && (
            <a className="icon-btn-flat hidden group-hover:inline-flex" href={site} target="_blank" rel="noopener noreferrer" aria-label="Open website" title="Open website">
              <ExternalLink />
            </a>
          )}
          <button className="icon-btn-flat" onClick={() => void copySecret(copy[0], copy[1])} aria-label={`Copy ${copy[1].toLowerCase()}`} title={`Copy ${copy[1].toLowerCase()}`}>
            <Copy />
          </button>
        </div>
      )}
    </div>
  )
}

/** The menu for an item (⋮ in the detail, or a long press). */
export function itemMenu(item: VaultItem, actions: { edit: () => void; move: () => void; deleteForever: () => void; select: (id: string) => void }): MenuEntry[] {
  const vault = useVault.getState()
  const run = (p: Promise<unknown>) => p.catch(toastError)
  if (item.tr)
    return [
      { label: 'Restore', icon: RotateCcw, onClick: () => void run(vault.restore([item.id]).then(() => toast(`Restored “${item.n}”`))) },
      { label: 'Delete forever', icon: Trash2, danger: true, onClick: actions.deleteForever },
    ]
  return [
    { label: 'Edit', icon: Pencil, onClick: actions.edit },
    {
      label: 'Clone',
      icon: CopyPlus,
      onClick: () =>
        void run(
          vault.save({ ...structuredClone(item), id: newVaultId(), n: `${item.n} (copy)`, fav: undefined, ct: nowSec() } as VaultItem).then((c) => {
            actions.select(c.id)
            toast(`Cloned “${item.n}”`)
          }),
        ),
    },
    { label: 'Move to folder', icon: FolderInput, onClick: actions.move },
    {
      label: item.fav ? 'Remove from favorites' : 'Add to favorites',
      icon: item.fav ? StarOff : Star,
      onClick: () => void run(vault.save({ ...item, fav: item.fav ? undefined : true })),
    },
    { label: 'Move to trash', icon: Trash2, danger: true, onClick: () => void run(vault.trash([item.id]).then(() => toast(`Moved “${item.n}” to the trash`))) },
  ]
}

export function ItemDetail(props: {
  item: VaultItem
  onEdit: () => void
  onMenu: (e: React.MouseEvent) => void
  onDeleteForever: () => void
}) {
  const { item, onEdit, onMenu, onDeleteForever } = props
  const folders = useVault((s) => s.folders)
  const rolledBack = useVault((s) => s.rollbacks.includes(item.id))
  const [history, setHistory] = useState(false)
  const folder = folders.find((f) => f.id === item.f)?.n
  const run = (p: Promise<unknown>) => p.catch(toastError)

  return (
    <div className="flex flex-col gap-4.5 p-5.5">
      <div className="flex items-center gap-3.5">
        <ItemTile item={item} large />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl leading-tight font-black tracking-[-0.02em] break-words">{item.n}</h2>
          <p className="text-[13px] text-muted">
            {TYPE_NAMES[item.ty].one}
            {folder && ` · ${folder}`}
          </p>
        </div>
        {!item.tr && (
          <button
            className={`icon-btn-flat ${item.fav ? 'text-brand-ink' : ''}`}
            onClick={() => void run(useVault.getState().save({ ...item, fav: item.fav ? undefined : true }))}
            aria-label={item.fav ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={!!item.fav}
          >
            <Star className={item.fav ? 'fill-current' : ''} />
          </button>
        )}
        <button className="icon-btn-flat" onClick={onMenu} aria-label="More actions">
          <MoreVertical />
        </button>
      </div>

      {item.tr ? (
        <Warning>
          In the trash for {Math.floor((nowSec() - item.tr) / 86_400)} days. Deleted forever in {daysLeft(item.tr)} days.
        </Warning>
      ) : null}
      {rolledBack && (
        <Warning>
          <span>An older version of this item came back (someone may have restored an old copy). Check it before you use it.</span>
          <span className="mt-2 flex flex-wrap gap-2">
            <button className="btn-secondary h-9" onClick={() => useVault.getState().acceptRollback(item.id)}>It’s fine</button>
            <button className="btn-secondary h-9" onClick={onEdit}>Edit it</button>
          </span>
        </Warning>
      )}

      <div className="border-t-2 border-ink">
        <Fields item={item} />
        {item.cf?.map((c, i) => <FieldRow key={i} label={c.k || 'Field'} value={c.v} secret={c.h} />)}
        {item.notes && <FieldRow label="Notes" value={item.notes} copy={false} />}
      </div>

      {item.ty === 'login' && !!item.ph?.length && (
        <div>
          <button className="btn-ghost -ml-2 h-9 px-2" onClick={() => setHistory(!history)} aria-expanded={history}>
            <History /> Password history ({item.ph.length}) {history ? <ChevronUp /> : <ChevronDown />}
          </button>
          {history && (
            <ul className="mt-1 space-y-1">
              {item.ph.map((h, i) => (
                <li key={i} className="flex items-center justify-between gap-3 text-[13px]">
                  <SecretText value={h.p} className="min-w-0" />
                  <span className="flex shrink-0 items-center text-muted">
                    {formatDate(h.d)}
                    <button className="icon-btn-flat size-8" onClick={() => void copySecret(h.p, 'Old password')} aria-label="Copy old password">
                      <Copy />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="text-xs text-muted">
        Created {formatDate(item.ct)} · Edited {formatDate(Math.floor(item.rd / 1000))}
      </p>
      <div className="flex flex-wrap gap-3">
        {item.tr ? (
          <>
            <button className="btn-secondary" onClick={() => void run(useVault.getState().restore([item.id]).then(() => toast(`Restored “${item.n}”`)))}>
              <RotateCcw /> Restore
            </button>
            <button className="btn-danger" onClick={onDeleteForever}>
              <Trash2 /> Delete forever
            </button>
          </>
        ) : (
          <>
            <button className="btn-secondary" onClick={onEdit}>
              <Pencil /> Edit
            </button>
            <button className="btn-danger" onClick={() => void run(useVault.getState().trash([item.id]).then(() => toast(`Moved “${item.n}” to the trash`)))}>
              <Trash2 /> Move to trash
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-l-[3px] border-brand py-1 pl-3.5 text-[13px] leading-relaxed">
      <TriangleAlert className="mt-0.5 size-5 shrink-0 text-brand-ink" strokeWidth={2} />
      <div className="flex min-w-0 flex-col">{children}</div>
    </div>
  )
}

function Fields({ item }: { item: VaultItem }) {
  switch (item.ty) {
    case 'login': {
      const d = item.d
      const changed = item.pc ?? item.ct
      return (
        <>
          <FieldRow label="Username" value={d.u} />
          <FieldRow
            label="Password"
            value={d.p}
            secret
            display={<SecretText value={d.p} />}
            extra={
              <>
                <StrengthMeter password={d.p} userInputs={[item.n, d.u]} />
                <p className="mt-0.5 text-xs text-muted">Changed {formatDate(changed)}</p>
              </>
            }
          />
          <OtpRow item={item} />
          {d.urls.map((u, i) => {
            const href = openableUrl(u.u)
            return (
              <FieldRow
                key={i}
                label={i ? `Website ${i + 1}` : 'Website'}
                value={u.u}
                display={
                  href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      {hostOf(u.u)}
                    </a>
                  ) : (
                    hostOf(u.u)
                  )
                }
                actions={
                  href && (
                    <a className="icon-btn-flat" href={href} target="_blank" rel="noopener noreferrer" aria-label="Open website">
                      <ExternalLink />
                    </a>
                  )
                }
              />
            )
          })}
        </>
      )
    }
    case 'card': {
      const d = item.d
      return (
        <>
          <CardPicture item={item} />
          <FieldRow label="Cardholder" value={d.h} />
          <FieldRow label="Number" value={d.num} display={groupCardNumber(d.num)} secret mono />
          <FieldRow label="Expiry" value={d.exp} mono />
          <FieldRow label="Security code" value={d.cvv} secret mono />
        </>
      )
    }
    case 'identity': {
      const d = item.d
      const address = [d.a1, d.a2, d.a3, [d.city, d.st, d.pin].filter(Boolean).join(' '), d.ctry].filter(Boolean).join('\n')
      return (
        <>
          <FieldRow label="Name" value={fullName(d)} />
          <FieldRow label="Email" value={d.em ?? ''} />
          <FieldRow label="Phone" value={d.ph ?? ''} />
          <FieldRow label="Address" value={address} />
          <FieldRow label="Aadhaar" value={d.aad ?? ''} display={d.aad && maskAadhaar(d.aad)} secret mono />
          <FieldRow label="PAN" value={d.pan?.toUpperCase() ?? ''} secret mono />
          <FieldRow label="Passport" value={d.pp ?? ''} secret mono />
          <FieldRow label="Driving licence" value={d.dl ?? ''} secret mono />
          <FieldRow label="Voter ID" value={d.vid ?? ''} secret mono />
          <FieldRow label="Username" value={d.un ?? ''} />
          <FieldRow label="Company" value={d.co ?? ''} />
        </>
      )
    }
    case 'note':
      return <FieldRow label="Note" value={item.d.t} />
  }
}

function CardPicture({ item }: { item: Extract<VaultItem, { ty: 'card' }> }) {
  const d = item.d
  return (
    <div className="my-3 flex aspect-[1.586] w-full max-w-80 flex-col justify-between rounded-lg bg-surface p-4.5 raised-md">
      <div className="flex items-center justify-between font-black tracking-[-0.01em]">
        <span className="truncate">{item.n}</span>
        <span>{cardBrand(d.num)}</span>
      </div>
      <span className="h-6.5 w-8.5 rounded-[5px] raised-xs" aria-hidden />
      <span className="font-mono text-[17px] font-bold tracking-[0.08em]">•••• •••• •••• {last4(d.num)}</span>
      <div className="flex justify-between text-[11px] font-extrabold tracking-[0.08em] uppercase">
        <span className="truncate">{d.h}</span>
        <span>{d.exp}</span>
      </div>
    </div>
  )
}
