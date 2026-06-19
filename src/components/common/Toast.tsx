import { useState, useEffect, useRef } from 'react'
import type { ToastType } from '../../stores/useToastStore'

interface ToastProps {
  message: string
  type?: ToastType
  actionLabel?: string
  onAction?: () => void
  onDismiss?: () => void
  visible: boolean
}

/** 按 type 选择图标 */
const TOAST_ICONS: Record<ToastType, string> = {
  info: '📖',
  error: '⚠',
  success: '✓',
}

export function Toast({ message, type = 'info', actionLabel, onAction, onDismiss, visible }: ToastProps) {
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

  // 按 type 区分边框/图标颜色：error 红色、success 绿色、info 默认
  const borderColor = type === 'error'
    ? 'border-red-500/50'
    : type === 'success'
      ? 'border-green-500/50'
      : 'border-[var(--border)]'
  const iconColor = type === 'error'
    ? 'text-red-400'
    : type === 'success'
      ? 'text-green-400'
      : ''

  // transform 由 inline style 接管（需要兼顾 -50% 水平居中），
  // 故 className 不再写 translate-y-*，避免被覆盖的死代码。
  return (
    <div
      className={`fixed top-4 left-1/2 z-50 transition-[opacity,transform] duration-slow ease-spring ${
        animate ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ transform: animate ? 'translate(-50%, 0)' : 'translate(-50%, -1rem)' }}
    >
      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg
                      bg-[var(--bg-primary)] border ${borderColor}
                      text-sm text-[var(--text-primary)] max-w-md`}>
        <span className={`text-lg flex-shrink-0 ${iconColor}`}>{TOAST_ICONS[type]}</span>
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
