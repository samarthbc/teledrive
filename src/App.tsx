import { Loader2, TriangleAlert } from 'lucide-react'
import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import DrivePage from './pages/Drive'
import LoginPage from './pages/Login'
import SetupPage from './pages/Setup'
import { useDrive } from './store/useDrive'

export default function App() {
  const phase = useDrive((s) => s.phase)
  const error = useDrive((s) => s.error)
  const boot = useDrive((s) => s.boot)

  useEffect(() => {
    void boot()
  }, [boot])

  if (phase === 'setup') return <SetupPage />
  if (phase === 'login') return <LoginPage />
  if (phase === 'error')
    return (
      <Centered>
        <TriangleAlert className="h-10 w-10 text-amber-500" />
        <p className="max-w-sm text-center text-sm text-slate-600 dark:text-slate-400">{error}</p>
        <button className="btn-primary" onClick={() => void boot()}>
          Try again
        </button>
      </Centered>
    )
  if (phase !== 'ready')
    return (
      <Centered>
        <Loader2 className="h-8 w-8 animate-spin text-brand" />
        <p className="text-sm text-slate-500">{phase === 'loading' ? 'Loading your drive…' : 'Connecting to Telegram…'}</p>
      </Centered>
    )

  return (
    <Routes>
      <Route path="/" element={<DrivePage />} />
      <Route path="/folder/:folderId" element={<DrivePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-4 p-6">{children}</div>
}
