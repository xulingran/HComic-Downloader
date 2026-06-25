import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { modalPresenceVariants, overlayPresenceVariants, reduceSafe, useReducedMotionPreference } from '../../lib/anim'

interface ModalProps {
  /** 控制弹窗显隐；Modal 内部用 AnimatePresence 接管 mount/unmount 并驱动动画 */
  isOpen: boolean
  /** 关闭回调；遮罩点击（满足方案 A 条件时）与 ESC 键都会触发 */
  onClose: () => void
  children: React.ReactNode
  /** 是否允许点击遮罩关闭，默认 true。迁移执行中等场景可设为 false */
  closeOnOverlayClick?: boolean
  /** z-index 数值，默认 50。ChapterDownloadDialog 等需要 60 覆盖在 Drawer 之上 */
  zIndex?: number
  /** 遮罩层额外类名（保留给特殊场景，一般无需传） */
  overlayClassName?: string
  /** 内层对话框类名：宽度、圆角、padding、flex 方向等 */
  contentClassName?: string
  /** 内层对话框内联样式：maxHeight、maxWidth 等 */
  contentStyle?: React.CSSProperties
  /** 无障碍标签；传则内层渲染 role="dialog" + aria-label */
  ariaLabel?: string
}

/**
 * 共享 Modal 组件。
 *
 * 关键设计——方案 A 安全遮罩点击关闭：
 * 浏览器的 click 事件按"mousedown 与 mouseup 的共同祖先"派发。当用户在内层输入框
 * 按下鼠标、拖到外层遮罩松手时，click 目标会被判定为遮罩，从而误触发遮罩的
 * onClick={onClose}——这正是"拖选文字逸出导致弹窗被关掉"的根因。
 *
 * 修复方法：用 mousedown 的落点判定"用户是否意图点击遮罩"。只有 mousedown 和 click
 * 都落在遮罩本身（e.target === e.currentTarget）时才关闭。拖选逸出场景中 mousedown
 * 必然在内层输入框，因此永远不会触发关闭。
 *
 * 动画策略（变更 2）：用 framer-motion AnimatePresence 替代手动 mounted/visible。
 * 遮罩层 motion.div 走纯 opacity variants，内层 motion.div 走 scale+opacity variants。
 * 交互逻辑（mousedown/click 判定）挂在外层 motion.div，与动画解耦。
 */
export function Modal({
  isOpen,
  onClose,
  children,
  closeOnOverlayClick = true,
  zIndex = 50,
  overlayClassName = '',
  contentClassName = '',
  contentStyle,
  ariaLabel,
}: ModalProps) {
  // 记录最近一次 mousedown 是否落在遮罩本身。仅在 mousedown 与后续 click 都命中
  // 遮罩本身时才视为"用户主动点遮罩关闭"，避免拖选文字逸出误触。
  const mouseDownOnOverlay = useRef(false)

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  const reduceMotion = useReducedMotionPreference()
  const contentVariants = reduceMotion ? reduceSafe(modalPresenceVariants) : modalPresenceVariants

  const handleOverlayMouseDown = (e: React.MouseEvent) => {
    mouseDownOnOverlay.current = e.target === e.currentTarget
  }

  const handleOverlayClick = (e: React.MouseEvent) => {
    const shouldClose =
      closeOnOverlayClick && mouseDownOnOverlay.current && e.target === e.currentTarget
    mouseDownOnOverlay.current = false
    if (shouldClose) onClose()
  }

  const contentProps = ariaLabel
    ? { role: 'dialog' as const, 'aria-label': ariaLabel }
    : {}

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="modal-overlay"
          data-testid="modal-overlay"
          variants={overlayPresenceVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          // zIndex 用内联 style 设置：Tailwind JIT 无法生成运行时拼接的 z-[${zIndex}] 类名，
          // 动态类名会被忽略导致层级失效。内联 style 可靠生效。
          style={{ zIndex }}
          className={`fixed inset-0 flex items-center justify-center bg-black/50 ${overlayClassName}`}
          onMouseDown={handleOverlayMouseDown}
          onClick={handleOverlayClick}
        >
          <motion.div
            {...contentProps}
            variants={contentVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className={contentClassName}
            style={contentStyle}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
