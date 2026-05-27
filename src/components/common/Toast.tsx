import { useState, useEffect, useRef } from 'react'

interface ToastProps {
  message: string
  actionLabel?: string
  onAction?: () => void
  onDismiss?: () => void
  visible: boolean
}

export function Toast({ message, actionLabel, onAction, onDismiss, visible }: ToastProps) {
  const [show, setShow] = useState(false)
  const [animate, setAnimate] = useState(false)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  useEffect(() => {
    if (visible) {
      cancelAnimationFrame(rafRef.current)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShow(true)
      rafRef.current = requestAnimationFrame(() => setAnimate(true))
    } else {
      cancelAnimationFrame(rafRef.current)
      setAnimate(false)
      const timer = setTimeout(() => setShow(false), 300)
      return () => clearTimeout(timer)
    }
  }, [visible])

  if (!show) return null

  return (
    <div
      className={`fixed top-4 left-1/2 z-50 transition-all duration-300 ease-out ${
        animate ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0'
      }`}
      style={{ transform: animate ? 'translate(-50%, 0)' : 'translate(-50%, -1rem)' }}
    >
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg
                      bg-[var(--bg-primary)] border border-[var(--border)]
                      text-sm text-[var(--text-primary)] max-w-md">
        <span className="text-lg">📖</span>
        <span className="flex-1">{message}</span>
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className="px-3 py-1 rounded-lg text-xs font-medium
                       bg-[var(--accent)] text-white hover:opacity-90
                       transition-opacity whitespace-nowrap"
          >
            {actionLabel}
          </button>
        )}
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]
                       transition-colors ml-1 flex-shrink-0"
            aria-label="关闭"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
