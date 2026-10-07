import { Check, ChevronDown, HardDrive, Images, KeyRound, Plus, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { driveName, isPhotosDrive, isVaultDrive, PHOTOS_NAME, VAULT_NAME, type DriveInfo } from '../telegram/channel'
import { useDrive } from '../store/useDrive'
import Logo from './Logo'

/**
 * The logo, "TeleDrive" and the open drive's name; tapping it lists the drives. TelePhotos and TeleWarden are listed
 * even before their channels exist (they're created when first opened).
 */
export default function DrivePicker(props: {
  onSwitchDrive: (id: string) => void
  onOpenPhotos: () => void
  onOpenVault: () => void
  onNewDrive: () => void
}) {
  const { onSwitchDrive, onOpenPhotos, onOpenVault, onNewDrive } = props
  const drives = useDrive((s) => s.drives)
  const currentDrive = useDrive((s) => s.currentDrive)
  const [picking, setPicking] = useState(false)
  const current = drives.find((d) => d.id === currentDrive)

  const iconOf = (d: DriveInfo) => (isPhotosDrive(d) ? Images : isVaultDrive(d) ? KeyRound : HardDrive)
  const open = (d: DriveInfo) => (isPhotosDrive(d) ? onOpenPhotos() : isVaultDrive(d) ? onOpenVault() : onSwitchDrive(d.id))
  const row = (key: string, Icon: LucideIcon, name: string, on: boolean, onClick: () => void) => (
    <button
      key={key}
      className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm font-semibold active:pressed"
      onClick={() => {
        setPicking(false)
        onClick()
      }}
    >
      <Icon className="size-4 shrink-0 text-muted" />
      <span className="truncate">{name}</span>
      {on && <Check className="ml-auto size-4 shrink-0 text-brand-ink" strokeWidth={2.5} />}
    </button>
  )
  // Built-in drives in their place (My Drive, TelePhotos, TeleWarden), then the others
  const [first, ...rest] = drives
  const photos = drives.find(isPhotosDrive)
  const vault = drives.find(isVaultDrive)
  const others = rest.filter((d) => !isPhotosDrive(d) && !isVaultDrive(d))

  return (
    <>
      <button
        className="mb-4 flex items-center gap-3 rounded-md px-1.5 py-1 text-left active:pressed"
        // Doesn't close the phone drawer: it only opens the list
        onClick={(e) => {
          e.stopPropagation()
          setPicking(!picking)
        }}
        aria-expanded={picking}
      >
        <Logo />
        <span className="min-w-0 flex-1">
          <span className="block text-lg leading-tight font-black tracking-tight">TeleDrive</span>
          <span className="block truncate text-xs text-muted">{current ? driveName(current) : ' '}</span>
        </span>
        <ChevronDown className={`size-4 shrink-0 text-muted transition-transform ${picking ? 'rotate-180' : ''}`} />
      </button>
      {picking && (
        <div className="mb-4 space-y-1 rounded-md p-1.5 pressed">
          {first && row(first.id, iconOf(first), driveName(first), first.id === currentDrive, () => open(first))}
          {photos
            ? row(photos.id, Images, driveName(photos), photos.id === currentDrive, onOpenPhotos)
            : row('photos', Images, PHOTOS_NAME, false, onOpenPhotos)}
          {vault ? row(vault.id, KeyRound, driveName(vault), vault.id === currentDrive, onOpenVault) : row('vault', KeyRound, VAULT_NAME, false, onOpenVault)}
          {others.map((d) => row(d.id, iconOf(d), driveName(d), d.id === currentDrive, () => open(d)))}
          <button
            className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm font-semibold text-muted active:pressed"
            onClick={() => {
              setPicking(false)
              onNewDrive()
            }}
          >
            <Plus className="size-4" /> New drive
          </button>
        </div>
      )}
    </>
  )
}
