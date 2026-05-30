import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChapterDownloadDialog } from '@/components/ChapterDownloadDialog'

const chapters = [
  { id: '999001', name: '第 1 話', index: 1 },
  { id: '999002', name: '第 2 話', index: 2 },
]

describe('ChapterDownloadDialog', () => {
  it('multi-selects chapters and confirms with selected ids in chapter order', () => {
    const onConfirm = vi.fn()
    render(<ChapterDownloadDialog chapters={chapters} open onConfirm={onConfirm} onCancel={() => {}} />)
    // click in reverse order; confirm should still return chapter order
    fireEvent.click(screen.getByLabelText('第 2 話'))
    fireEvent.click(screen.getByLabelText('第 1 話'))
    fireEvent.click(screen.getByText('下载选中'))
    expect(onConfirm).toHaveBeenCalledWith(['999001', '999002'])
  })

  it('select-all toggles every chapter', () => {
    const onConfirm = vi.fn()
    render(<ChapterDownloadDialog chapters={chapters} open onConfirm={onConfirm} onCancel={() => {}} />)
    fireEvent.click(screen.getByText('全选'))
    fireEvent.click(screen.getByText('下载选中'))
    expect(onConfirm).toHaveBeenCalledWith(['999001', '999002'])
  })

  it('download button is disabled when nothing is selected', () => {
    render(<ChapterDownloadDialog chapters={chapters} open onConfirm={vi.fn()} onCancel={() => {}} />)
    expect(screen.getByText('下载选中')).toBeDisabled()
  })

  it('renders nothing when closed', () => {
    const { container } = render(
      <ChapterDownloadDialog chapters={chapters} open={false} onConfirm={vi.fn()} onCancel={() => {}} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('cancel fires onCancel', () => {
    const onCancel = vi.fn()
    render(<ChapterDownloadDialog chapters={chapters} open onConfirm={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByText('取消'))
    expect(onCancel).toHaveBeenCalled()
  })
})
