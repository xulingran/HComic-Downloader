import { useEffect } from 'react'
import { Toast } from './Toast'
import { useToastStore } from '../../stores/useToastStore'

/** Toast 自动消失时长（毫秒） */
const AUTO_DISMISS_MS = 4000

/**
 * 全局 Toaster：消费 useToastStore，渲染 Toast。
 *
 * - 非 persistent Toast：可见时启动 4 秒自动消失计时器
 * - persistent Toast：不自动消失，仅由调用方显式 dismiss 或外部条件关闭
 *
 * 任何组件可通过 `useToastStore.getState().error('...')` 触发 Toast。
 * 与致命横幅分层：Toaster 固定顶部居中（z-50），不与 FatalBanner 冲突。
 */
export function Toaster() {
  const toast = useToastStore((s) => s.toast)
  const dismiss = useToastStore((s) => s.dismiss)

  // toast 可见且非 persistent 时启动自动消失计时器；隐藏/文案变化/切到 persistent 时重置
  useEffect(() => {
    if (!toast.visible || toast.persistent) return
    const timer = setTimeout(() => {
      dismiss()
    }, AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [toast.visible, toast.persistent, toast.message, dismiss])

  return (
    <Toast
      message={toast.message}
      type={toast.type}
      visible={toast.visible}
      actionLabel={toast.actionLabel}
      onAction={toast.onAction}
      onDismiss={dismiss}
    />
  )
}
