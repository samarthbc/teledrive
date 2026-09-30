import { create } from 'zustand'

export interface Toast {
  id: number
  message: string
  kind: 'info' | 'error'
}

interface ToastState {
  toasts: Toast[]
  show: (message: string, kind?: Toast['kind']) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToast = create<ToastState>((set, get) => ({
  toasts: [],
  show: (message, kind = 'info') => {
    const id = nextId++
    set({ toasts: [...get().toasts, { id, message, kind }] })
    setTimeout(() => get().dismiss(id), kind === 'error' ? 6000 : 3000)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))

export const toast = (message: string) => useToast.getState().show(message)
export const toastError = (e: unknown) =>
  useToast.getState().show(e instanceof Error ? e.message : String(e), 'error')
