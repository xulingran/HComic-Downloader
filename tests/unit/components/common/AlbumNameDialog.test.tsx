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

  it('首次打开即显示准确的非零数量回退文案', () => {
    // 模拟 SearchPage 常驻挂载场景：isOpen=false 首次渲染，随后翻 true
    const defaultName = '批量下载 - 4本漫画'
    const { rerender } = render(
      <AlbumNameDialog isOpen={false} defaultName={defaultName} comicCount={4} onConfirm={vi.fn()} onCancel={vi.fn()} />
    )
    rerender(
      <AlbumNameDialog isOpen defaultName={defaultName} comicCount={4} onConfirm={vi.fn()} onCancel={vi.fn()} />
    )
    expect(screen.getByDisplayValue('批量下载 - 4本漫画')).toBeInTheDocument()
    expect(screen.getByText('将选中的 4 本漫画打包为一个专辑下载')).toBeInTheDocument()
  })

  it('常驻挂载多次打开时显示最新 defaultName（修复 useState 不同步 bug）', () => {
    const { rerender } = render(
      <AlbumNameDialog isOpen={false} defaultName="首次" comicCount={1} onConfirm={vi.fn()} onCancel={vi.fn()} />
    )
    // 第一次打开
    rerender(
      <AlbumNameDialog isOpen defaultName="作品A" comicCount={2} onConfirm={vi.fn()} onCancel={vi.fn()} />
    )
    expect(screen.getByDisplayValue('作品A')).toBeInTheDocument()
    // 关闭
    rerender(
      <AlbumNameDialog isOpen={false} defaultName="作品A" comicCount={2} onConfirm={vi.fn()} onCancel={vi.fn()} />
    )
    // 第二次打开，defaultName 已变（选中了不同的漫画）
    rerender(
      <AlbumNameDialog isOpen defaultName="作品B" comicCount={3} onConfirm={vi.fn()} onCancel={vi.fn()} />
    )
    expect(screen.getByDisplayValue('作品B')).toBeInTheDocument()
    // 禁止残留第一次的值
    expect(screen.queryByDisplayValue('作品A')).not.toBeInTheDocument()
  })

  it('弹窗保持打开期间父组件重渲染不覆盖用户编辑', async () => {
    const { rerender } = render(
      <AlbumNameDialog isOpen defaultName="[作者] 某作品" comicCount={2} onConfirm={vi.fn()} onCancel={vi.fn()} />
    )
    const input = screen.getByDisplayValue('[作者] 某作品') as HTMLInputElement
    // 用户手动清空并输入新内容
    await act(async () => {
      fireEvent.change(input, { target: { value: '我的合集' } })
    })
    expect(input.value).toBe('我的合集')
    // 父组件重渲染（defaultName 引用变化但内容相同，模拟父组件因他因重渲染）
    rerender(
      <AlbumNameDialog isOpen defaultName="[作者] 某作品" comicCount={2} onConfirm={vi.fn()} onCancel={vi.fn()} />
    )
    // 用户编辑必须保留
    expect(screen.getByDisplayValue('我的合集')).toBeInTheDocument()
  })

  it('确认按钮在输入为空时禁用，非空时调用 onConfirm', async () => {
    const onConfirm = vi.fn()
    render(
      <AlbumNameDialog isOpen defaultName="某专辑" comicCount={2} onConfirm={onConfirm} onCancel={vi.fn()} />
    )
    const input = screen.getByDisplayValue('某专辑') as HTMLInputElement
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

  it('取消按钮与背景遮罩点击触发 onCancel', () => {
    const onCancel = vi.fn()
    const { container } = render(
      <AlbumNameDialog isOpen defaultName="x" comicCount={1} onConfirm={vi.fn()} onCancel={onCancel} />
    )
    fireEvent.click(screen.getByText('取消'))
    expect(onCancel).toHaveBeenCalledTimes(1)

    // 背景遮罩（外层 div）点击也触发取消
    const overlay = container.firstElementChild as HTMLElement
    fireEvent.click(overlay)
    expect(onCancel).toHaveBeenCalledTimes(2)
  })
})
