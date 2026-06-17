import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { AlbumNameDialog } from '@/components/common/AlbumNameDialog'

describe('AlbumNameDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <AlbumNameDialog isOpen={false} defaultName="x" comicCount={1} onConfirm={vi.fn()} onCancel={vi.fn()} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('首次打开即显示准确的非零数量回退文案', async () => {
    // 模拟 SearchPage 常驻挂载场景：isOpen=false 首次渲染，随后翻 true。
    // Modal 内部经 effect+rAF 完成 mount，用 findBy 等待内容出现。
    const defaultName = '批量下载 - 4本漫画'
    const { rerender } = render(
      <AlbumNameDialog isOpen={false} defaultName={defaultName} comicCount={4} onConfirm={vi.fn()} onCancel={vi.fn()} />
    )
    rerender(
      <AlbumNameDialog isOpen defaultName={defaultName} comicCount={4} onConfirm={vi.fn()} onCancel={vi.fn()} />
    )
    expect(await screen.findByDisplayValue('批量下载 - 4本漫画')).toBeInTheDocument()
    expect(screen.getByText('将选中的 4 本漫画打包为一个专辑下载')).toBeInTheDocument()
  })

  it('Modal 接管 mount：每次打开都是全新挂载，显示最新 defaultName', async () => {
    // 核心契约：Modal 关闭即卸载子组件，下次打开重新挂载，
    // useState(defaultName) 自然拿到最新值——不再依赖 wasOpen 渲染期同步逻辑。
    // 用独立的 render/unmount 隔离每次打开，避免动画 transitionEnd 的时序耦合。
    const { unmount } = render(
      <AlbumNameDialog isOpen defaultName="作品A" comicCount={2} onConfirm={vi.fn()} onCancel={vi.fn()} />
    )
    expect(await screen.findByDisplayValue('作品A')).toBeInTheDocument()
    // 完全卸载（模拟 Modal 关闭后卸载子组件）
    unmount()

    // 第二次"打开"——全新挂载，defaultName 已变（选中了不同的漫画）
    render(
      <AlbumNameDialog isOpen defaultName="作品B" comicCount={3} onConfirm={vi.fn()} onCancel={vi.fn()} />
    )
    expect(await screen.findByDisplayValue('作品B')).toBeInTheDocument()
    // 禁止残留第一次的值
    expect(screen.queryByDisplayValue('作品A')).not.toBeInTheDocument()
  })

  it('确认按钮在输入为空时禁用，非空时调用 onConfirm', async () => {
    const onConfirm = vi.fn()
    render(
      <AlbumNameDialog isOpen defaultName="某专辑" comicCount={2} onConfirm={onConfirm} onCancel={vi.fn()} />
    )
    const input = (await screen.findByDisplayValue('某专辑')) as HTMLInputElement
    const confirmBtn = screen.getByText('确认下载')
    expect(confirmBtn).not.toBeDisabled()
    await act(async () => {
      fireEvent.click(confirmBtn)
    })
    expect(onConfirm).toHaveBeenCalledWith('某专辑')

    // 清空后禁用
    await act(async () => {
      fireEvent.change(input, { target: { value: '' } })
    })
    expect(screen.getByText('确认下载')).toBeDisabled()
  })

  it('取消按钮与背景遮罩点击触发 onCancel', async () => {
    const onCancel = vi.fn()
    const { container } = render(
      <AlbumNameDialog isOpen defaultName="x" comicCount={1} onConfirm={vi.fn()} onCancel={onCancel} />
    )
    // 等待 Modal 完成 mount
    await screen.findByDisplayValue('x')
    fireEvent.click(screen.getByText('取消'))
    expect(onCancel).toHaveBeenCalledTimes(1)

    // 背景遮罩（外层 div）点击也触发取消。
    // 方案 A：需要 mousedown 与 click 均落在遮罩本身，避免拖选文字逸出误触。
    const overlay = container.firstElementChild as HTMLElement
    fireEvent.mouseDown(overlay)
    fireEvent.click(overlay)
    expect(onCancel).toHaveBeenCalledTimes(2)
  })
})
