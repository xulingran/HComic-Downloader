import { useEffect } from 'react'
import { Toast } from './Toast'
import { useToastStore } from '../../stores/useToastStore'

/** Toast 自动消失时长（毫秒） */
const AUTO_DISMISS_MS = 4000

/**
 * 全局 Toaster：消费 useToastStore，渲染 Toast 并在 4 秒后自动隐藏。
 *
 * 任何组件可通过 `useToastStore.getState().error('...')` 触发 Toast。
 * 与致命横幅分层：Toaster 固定顶部居中（z-50），不与 FatalBanner 冲突。
 */
export function Toaster() {
  const toast = useToastStore((s) => s.toast)
  const dismiss = useToastStore((s) => s.dismiss)

  // toast 可见时启动自动消失计时器；隐藏或 message 变化时重置
  useEffect(() => {
    if (!toast.visible) return
    const timer = setTimeout(() => {
      dismiss()
    }, AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [toast.visible, toast.message, dismiss])

  return (
    <Toast
      message={toast.message}
      type={toast.type}
      visible={toast.visible}
      onDismiss={dismiss}
    />
  )
}
