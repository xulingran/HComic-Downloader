import { useEffect, useRef } from 'react'
import { useModalAnimation } from '../../hooks/useModalAnimation'

interface ModalProps {
  /** 控制弹窗显隐；Modal 内部接管 mount/unmount 并驱动淡入淡出动画 */
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
 * 内层内容无需再调用 stopPropagation——外层的 e.target === e.currentTarget 精确判断
 * 已经排除了内层点击。
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
  const { mounted, visible, handleTransitionEnd } = useModalAnimation(isOpen)

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

  if (!mounted) return null

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

  // 动画策略：只让内层承担 transition 与 onTransitionEnd，遮罩用静态 bg-black/50。
  // 这样 handleTransitionEnd 只接收内层的事件，unmount 时机清晰，不会被遮罩的事件干扰。
  // 遮罩的"淡入淡出感"通过内层 scale+opacity 的弹性动画自然带出，无需遮罩自己也 transition。
  return (
    <div
      className={`fixed inset-0 z-[${zIndex}] flex items-center justify-center bg-black/50 ${overlayClassName}`}
      onMouseDown={handleOverlayMouseDown}
      onClick={handleOverlayClick}
    >
      <div
        {...contentProps}
        onTransitionEnd={handleTransitionEnd}
        className={`transition-all duration-200 ease-out ${
          visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
        } ${contentClassName}`}
        style={contentStyle}
      >
        {children}
      </div>
    </div>
  )
}
