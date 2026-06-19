import { useState, useEffect, useCallback } from 'react'
import { useReducedMotionPreference } from '../lib/anim'

/**
 * 统一的 presence 动画 hook。
 *
 * 设计目标——与旧 `useModalAnimation` **完全相同的返回签名**：
 *   { mounted, visible, handleTransitionEnd }
 * 3 个调用方（Modal、ComicInfoDrawer、ComicReaderModal）可以零改动切换，
 * 测试 `Modal.test.tsx` 的 rAF 时序假设仍然成立。
 *
 * 与旧 hook 的唯一差异：增加 reduced-motion 感知。当
 * prefers-reduced-motion: reduce 时，跳过双层 rAF，直接同步
 * mounted=true / visible=true，让组件立即显示（因为反正没有过渡动画）。
 *
 * 旧 hook（useModalAnimation）内部委托给本 hook，保证未迁移的调用方
 * 也能获得 reduced-motion 感知。
 */
export function usePresenceAnimation(open: boolean) {
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const reduceMotion = useReducedMotionPreference()

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMounted(true)
      if (reduceMotion) {
        // reduced-motion：跳过 rAF 等待，同步进入终态
        setVisible(true)
        return
      }
      // 双层 rAF：确保 mounted 提交、起始态被 paint 后再翻 visible，
      // 否则 transition 起始态未被浏览器捕获，动画不会触发。
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true))
      })
    } else {
      setVisible(false)
    }
  }, [open, reduceMotion])

  const handleTransitionEnd = useCallback(() => {
    if (!visible) {
      setMounted(false)
    }
  }, [visible])

  return { mounted, visible, handleTransitionEnd }
}
