import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SourcePickerModal } from '@/components/common/SourcePickerModal'
import { SOURCES_WITH_FAVOURITES, SOURCE_LABELS } from '@shared/types'

describe('SourcePickerModal', () => {
  it('isOpen=false 时不渲染', () => {
    const { container } = render(
      <SourcePickerModal isOpen={false} onSelect={vi.fn()} onClose={vi.fn()} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('isOpen=true 时渲染且仅展示支持收藏的来源（4 个，无 copymanga）', async () => {
    render(<SourcePickerModal isOpen onSelect={vi.fn()} onClose={vi.fn()} />)
    // 等待弹窗 mount 完成（标题出现）
    await screen.findByText('选择收藏夹来源')
    expect(screen.getByText('请选择要查看的收藏夹来源，之后可在左侧来源栏随时切换')).toBeInTheDocument()
    expect(screen.queryByText(/顶部下拉框/)).not.toBeInTheDocument()
    // 每个支持收藏的来源按钮都应出现
    for (const s of SOURCES_WITH_FAVOURITES) {
      expect(screen.getByText(SOURCE_LABELS[s])).toBeInTheDocument()
    }
    // copymanga 不应出现
    expect(screen.queryByText('拷贝漫画')).not.toBeInTheDocument()
  })

  it('点击来源按钮触发 onSelect 并传入对应来源', async () => {
    const onSelect = vi.fn()
    render(<SourcePickerModal isOpen onSelect={onSelect} onClose={vi.fn()} />)
    await screen.findByText('选择收藏夹来源')

    fireEvent.click(screen.getByText(SOURCE_LABELS['jm']))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('jm')
  })

  it('点击「稍后再说」按钮触发 onClose（跳过）', async () => {
    const onClose = vi.fn()
    render(<SourcePickerModal isOpen onSelect={vi.fn()} onClose={onClose} />)
    await screen.findByText('选择收藏夹来源')

    fireEvent.click(screen.getByText('稍后再说'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('按下 ESC 触发 onClose', async () => {
    const onClose = vi.fn()
    render(<SourcePickerModal isOpen onSelect={vi.fn()} onClose={onClose} />)
    await screen.findByText('选择收藏夹来源')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
