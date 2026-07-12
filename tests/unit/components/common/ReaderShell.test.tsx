import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReaderShell } from '@/components/common/ReaderShell'
import type { ChapterInfo } from '@shared/types'
import { createRef } from 'react'

// 构造一组满足 ReaderShell 必填 props 的默认值，每个用例按需覆盖。
function defaultProps(overrides: Record<string, unknown> = {}) {
  const noop = vi.fn()
  return {
    open: true,
    onClose: noop,
    title: '测试漫画',
    currentPage: 1,
    effectiveTotal: 10,
    navigationEnabled: true,
    displayMode: 'scroll' as const,
    onDisplayModeRequest: noop,
    imageWidth: 70,
    setImageWidth: noop,
    pageGap: 4,
    setPageGap: noop,
    blankPosition: 'none' as const,
    setBlankPosition: noop,
    zoom: 1,
    zoomIn: noop,
    zoomOut: noop,
    resetZoom: noop,
    settingsOpen: false,
    setSettingsOpen: noop,
    sliderRef: createRef<HTMLDivElement>(),
    isDragging: false,
    handleSliderPointerDown: noop,
    handleSliderPointerMove: noop,
    handleSliderPointerUp: noop,
    cancelDrag: noop,
    preloadedRanges: [],
    ...overrides,
  }
}

const twoChapters: ChapterInfo[] = [
  { id: 'ch1', name: '第一章', index: 0, pages: 5 },
  { id: 'ch2', name: '第二章', index: 1, pages: 5 },
]

describe('ReaderShell', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<ReaderShell {...defaultProps({ open: false })}>content</ReaderShell>)
    expect(container.innerHTML).toBe('')
  })

  it('renders title and page indicator in header when open', () => {
    render(<ReaderShell {...defaultProps()}>content</ReaderShell>)
    expect(screen.getByText('测试漫画')).toBeInTheDocument()
    // header pill 显示页码
    expect(screen.getAllByText('1 / 10').length).toBeGreaterThanOrEqual(1)
  })

  it('calls onClose when close button clicked', async () => {
    const onClose = vi.fn()
    render(<ReaderShell {...defaultProps({ onClose })}>content</ReaderShell>)
    await userEvent.click(screen.getByText('关闭'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders slider track with correct aria attributes', () => {
    render(<ReaderShell {...defaultProps({ currentPage: 3, effectiveTotal: 10 })}>content</ReaderShell>)
    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('aria-valuemin', '1')
    expect(slider).toHaveAttribute('aria-valuemax', '10')
    expect(slider).toHaveAttribute('aria-valuenow', '3')
  })

  it('hides page indicators and slider when navigation is disabled', () => {
    render(<ReaderShell {...defaultProps({ effectiveTotal: 0, navigationEnabled: false })}>content</ReaderShell>)
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(screen.queryByText('1 / 0')).not.toBeInTheDocument()
  })

  it('renders settings gear button and toggles settings panel', async () => {
    const setSettingsOpen = vi.fn()
    render(<ReaderShell {...defaultProps({ setSettingsOpen })}>content</ReaderShell>)
    expect(screen.getByLabelText('阅读设置')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('阅读设置'))
    expect(setSettingsOpen).toHaveBeenCalledWith(true)
  })

  it('shows display mode buttons when settings panel is open', () => {
    render(<ReaderShell {...defaultProps({ settingsOpen: true })}>content</ReaderShell>)
    expect(screen.getByLabelText('连续滚动')).toBeInTheDocument()
    expect(screen.getByLabelText('单页显示')).toBeInTheDocument()
    expect(screen.getByLabelText('双页显示')).toBeInTheDocument()
    expect(screen.getByLabelText('连续滚动')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('reader-mode-indicator')).toBeInTheDocument()
  })

  it('sends a display-mode intent and exposes the controlled active mode', async () => {
    const onDisplayModeRequest = vi.fn()
    const { rerender } = render(
      <ReaderShell {...defaultProps({ settingsOpen: true, onDisplayModeRequest })}>content</ReaderShell>,
    )

    await userEvent.click(screen.getByLabelText('双页显示'))
    expect(onDisplayModeRequest).toHaveBeenCalledWith('double')

    rerender(
      <ReaderShell {...defaultProps({ settingsOpen: true, displayMode: 'double', onDisplayModeRequest })}>content</ReaderShell>,
    )
    expect(screen.getByLabelText('双页显示')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('连续滚动')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getAllByTestId('reader-mode-indicator')).toHaveLength(1)
  })

  it('does not render chapter nav buttons when chapters are absent', () => {
    render(<ReaderShell {...defaultProps()}>content</ReaderShell>)
    expect(screen.queryByLabelText('上一章')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('下一章')).not.toBeInTheDocument()
  })

  it('renders prev/next chapter buttons and disables prev on first chapter', () => {
    render(
      <ReaderShell {...defaultProps({ chapters: twoChapters, currentChapterIndex: 0 })}>
        content
      </ReaderShell>,
    )
    expect(screen.getByLabelText('上一章')).toBeDisabled()
    expect(screen.getByLabelText('下一章')).toBeEnabled()
  })

  it('opens the chapter picker from the shared chapter action', async () => {
    const onOpenChapterPicker = vi.fn()
    render(
      <ReaderShell
        {...defaultProps({ chapters: twoChapters, currentChapterIndex: 0, onOpenChapterPicker })}
      >
        content
      </ReaderShell>,
    )
    await userEvent.click(screen.getByLabelText('章节列表'))
    expect(onOpenChapterPicker).toHaveBeenCalledTimes(1)
  })

  it('disables next chapter button on last chapter', () => {
    render(
      <ReaderShell {...defaultProps({ chapters: twoChapters, currentChapterIndex: 1 })}>
        content
      </ReaderShell>,
    )
    expect(screen.getByLabelText('上一章')).toBeEnabled()
    expect(screen.getByLabelText('下一章')).toBeDisabled()
  })

  it('renders children content area', () => {
    render(
      <ReaderShell {...defaultProps()}>
        <div data-testid="shell-child">阅读内容</div>
      </ReaderShell>,
    )
    expect(screen.getByTestId('shell-child')).toHaveTextContent('阅读内容')
  })
})
