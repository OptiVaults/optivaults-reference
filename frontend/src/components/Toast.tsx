/**
 * Toast notification system — persists across page navigation
 */
import { useState, useEffect, createContext, useContext, useCallback } from 'react'

type ToastType = 'success' | 'error' | 'info'

interface Toast {
  id: number
  message: string
  type: ToastType
  duration: number
}

interface ToastContextType {
  addToast: (message: string, type?: ToastType, duration?: number) => void
}

const ToastContext = createContext<ToastContextType | null>(null)
let toastId = 0

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be inside ToastProvider')
  return ctx
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback((message: string, type: ToastType = 'info', duration = 5000) => {
    const id = ++toastId
    setToasts(prev => [...prev, { id, message, type, duration }])
  }, [])

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="fixed bottom-20 sm:bottom-6 right-4 z-50 space-y-2 max-w-sm">
        {toasts.map(toast => (
          <ToastItem key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, toast.duration)
    return () => clearTimeout(timer)
  }, [toast.duration, onDismiss])

  const colors = {
    success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    error: 'border-red-500/40 bg-red-500/10 text-red-300',
    info: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300',
  }
  const icons = {
    success: '\u2705',
    error: '\u274C',
    info: '\u2139\uFE0F',
  }

  return (
    <div
      className={`flex items-start gap-2 px-4 py-3 rounded-xl border backdrop-blur-sm shadow-lg text-sm animate-slide-in ${colors[toast.type]}`}
      onClick={onDismiss}
      role="alert"
    >
      <span className="text-base shrink-0">{icons[toast.type]}</span>
      <span className="flex-1">{toast.message}</span>
      <button className="text-slate-500 hover:text-white shrink-0 ml-1" onClick={onDismiss}>&times;</button>
    </div>
  )
}
