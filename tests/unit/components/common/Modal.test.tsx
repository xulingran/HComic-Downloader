import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Modal } from '@/components/common/Modal'

/** 渲染 Modal 并返回遮罩元素的便捷工具。
 *  Modal 通过 createPortal 渲染到 document.body，遮罩 motion.div 带 data-testid="modal-overlay"。
 *  内层内容用 data-testid="content" 标记，由调用方用 await findByTestId 等待 mount 完成。 */
async function renderModal(
  props: React.ComponentProps<typeof Modal> & { contentText?: string },
) {
  const { contentText = '内容', ...modalProps } = props
  const utils = render(
    <Modal {...modalProps}>
      <div data-testid="content">{contentText}</div>
    </Modal>,
  )
  // Portal 渲染到 body，遮罩通过 testid 定位；isOpen=true 时需等待 mount
  const overlay = modalProps.isOpen
    ? await screen.findByTestId('modal-overlay')
    : null
  return { ...utils, overlay }
}

describe('Modal', () => {
  it('isOpen=false 时不渲染任何内容', async () => {
    const { container } = await renderModal({ isOpen: false, onClose: vi.fn() })
    expect(container.innerHTML).toBe('')
  })

  it('isOpen=true 时渲染遮罩与内容', async () => {
    await renderModal({ isOpen: true, onClose: vi.fn() })
    // Modal 经 effect+rAF 完成 mount，用 findBy 等待内容出现
    expect(await screen.findByTestId('content')).toBeInTheDocument()
    expect(screen.getByText('内容')).toBeInTheDocument()
  })

  it('点击遮罩本身（mousedown 与 click 均落在遮罩）触发 onClose', async () => {
    const onClose = vi.fn()
    const { overlay } = await renderModal({ isOpen: true, onClose })
    await screen.findByTestId('content')
    // 完整的点击序列：mousedown → click，都落在遮罩
    fireEvent.mouseDown(overlay!)
    fireEvent.click(overlay!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('点击内层内容不触发 onClose（mousedown 与 click 均落在内容）', async () => {
    const onClose = vi.fn()
    await renderModal({ isOpen: true, onClose })
    const content = await screen.findByTestId('content')
    fireEvent.mouseDown(content)
    fireEvent.click(content)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('【核心 bug 修复】mousedown 在内层、click 在遮罩（拖选文字逸出）不触发 onClose', async () => {
    // 这是用户报告的 bug 精确复现：
    // 用户在输入框按下鼠标开始拖选 → 鼠标拖到遮罩 → 在遮罩上松手
    // 浏览器此时派发 click，target 为遮罩（mousedown 与 mouseup 的共同祖先）。
    // 旧实现会触发遮罩 onClick={onClose}；方案 A 用 mousedown 起点判定，不应触发。
    const onClose = vi.fn()
    const { overlay } = await renderModal({ isOpen: true, onClose })
    const content = await screen.findByTestId('content')
    // mousedown 落在内层（模拟用户在输入框按下）
    fireEvent.mouseDown(content)
    // click 落在遮罩（模拟拖到外面松手）
    fireEvent.click(overlay!)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closeOnOverlayClick=false 时点击遮罩不触发 onClose', async () => {
    const onClose = vi.fn()
    const { overlay } = await renderModal({ isOpen: true, onClose, closeOnOverlayClick: false })
    await screen.findByTestId('content')
    fireEvent.mouseDown(overlay!)
    fireEvent.click(overlay!)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('ESC 键触发 onClose', async () => {
    const onClose = vi.fn()
    await renderModal({ isOpen: true, onClose })
    await screen.findByTestId('content')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('isOpen=false 时不监听 ESC', async () => {
    const onClose = vi.fn()
    await renderModal({ isOpen: false, onClose })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('ariaLabel 传入时内层渲染 role="dialog" 与 aria-label', async () => {
    await renderModal({ isOpen: true, onClose: vi.fn(), ariaLabel: '测试对话框' })
    await screen.findByTestId('content')
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-label', '测试对话框')
  })

  it('zIndex prop 应用到遮罩的内联 style', async () => {
    const { overlay } = await renderModal({ isOpen: true, onClose: vi.fn(), zIndex: 60 })
    await screen.findByTestId('content')
    // zIndex 用内联 style 设置（Tailwind JIT 无法生成运行时拼接的 z-[N] 类名）
    expect(overlay!.style.zIndex).toBe('60')
  })

  it('Modal 打开时渲染 motion 容器并应用进出场 variants', async () => {
    // 变更 2：迁移到 framer-motion AnimatePresence 后，不再用 visible 切换 className，
    // 而是渲染 motion.div 并通过 variants 驱动动画。jsdom 不执行真实动画，
    // 仅验证 content 能被渲染（动画行为由真机回归覆盖）。
    await renderModal({ isOpen: true, onClose: vi.fn() })
    const content = await screen.findByTestId('content')
    expect(content).toBeInTheDocument()
  })
})
