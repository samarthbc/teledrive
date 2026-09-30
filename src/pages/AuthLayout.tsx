import type { LucideIcon } from 'lucide-react'

export default function AuthLayout(props: {
  icon: LucideIcon
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  const { icon: Icon, title, subtitle, children } = props
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6 sm:p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white shadow-lg shadow-brand/30">
            <Icon className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  )
}
