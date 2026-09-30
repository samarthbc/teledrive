import { create } from 'zustand'

export interface Toast {
  id: number
  message: string
  kind: 'info' | 'error'
  action?: ToastAction
}

export interface ToastAction {
  label: string
  onClick: () => void
}

interface ToastState {
  toasts: Toast[]
  show: (message: string, kind?: Toast['kind'], action?: ToastAction) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToast = create<ToastState>((set, get) => ({
  toasts: [],
  show: (message, kind = 'info', action) => {
    const id = nextId++
    set({ toasts: [...get().toasts, { id, message, kind, action }] })
    setTimeout(() => get().dismiss(id), kind === 'error' || action ? 6000 : 3000)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))

export const toast = (message: string, action?: ToastAction) => useToast.getState().show(message, 'info', action)
export const toastError = (e: unknown) =>
  useToast.getState().show(e instanceof Error ? e.message : String(e), 'error')
