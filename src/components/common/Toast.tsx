import { AnimatePresence, motion } from 'framer-motion'
import { toastPresenceVariants, reduceSafe, useReducedMotionPreference } from '../../lib/anim'
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
  const reduceMotion = useReducedMotionPreference()
  const variants = reduceMotion ? reduceSafe(toastPresenceVariants) : toastPresenceVariants

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

  return (
    // Toast 通过 left-1/2 + 静态 x:-50% 实现水平居中，variants 仅控制 y 与 opacity。
    // AnimatePresence 在 visible 翻为 false 时保留 motion.div 直到 exit 动画结束。
    <div className="fixed top-4 left-1/2 z-50" style={{ transform: 'translateX(-50%)' }}>
      <AnimatePresence>
        {visible && (
          <motion.div
            key="toast"
            variants={variants}
            initial="initial"
            animate="animate"
            exit="exit"
            className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg
                        bg-[var(--bg-primary)] border ${borderColor}
                        text-sm text-[var(--text-primary)] max-w-md`}
          >
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
