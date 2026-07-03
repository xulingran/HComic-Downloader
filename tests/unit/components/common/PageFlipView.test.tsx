import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { PageFlipView, inferPageDirection } from '@/components/PageFlipView'
import type { DisplayMode } from '@/hooks/useReaderSettings'

const mockFetchPreviewImage = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockFetchPreviewImage.mockResolvedValue({ urlHash: 'c'.repeat(64) })
  Object.defineProperty(window, 'hcomic', {
    value: { fetchPreviewImage: mockFetchPreviewImage },
    writable: true,
    configurable: true,
  })
})

class MockIntersectionObserver {
  readonly root: Element | null = null
  readonly rootMargin: string = ''
  readonly thresholds: ReadonlyArray<number> = []
  private callback: IntersectionObserverCallback

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return [] }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IntersectionObserver = MockIntersectionObserver

const defaultProps = {
  imageUrls: ['url1', 'url2', 'url3', 'url4'],
  totalPages: 4,
  currentPage: 1,
  setCurrentPage: vi.fn(),
  displayMode: 'single' as DisplayMode,
  imageWidth: 70,
  imageCacheRef: { current: new Map<number, string>() },
  cacheVersion: 0,
  onPageChange: vi.fn(),
}

describe('PageFlipView', () => {
  it('renders the current page image in single mode', async () => {
    render(<PageFlipView {...defaultProps} />)
    await waitFor(() => expect(mockFetchPreviewImage).toHaveBeenCalledWith('url1', undefined, undefined, undefined))
  })

  it('renders two pages side by side in double mode', async () => {
    render(<PageFlipView {...defaultProps} displayMode="double" />)
    await waitFor(() => {
      expect(mockFetchPreviewImage).toHaveBeenCalledWith('url1', undefined, undefined, undefined)
      expect(mockFetchPreviewImage).toHaveBeenCalledWith('url2', undefined, undefined, undefined)
    })
  })

  it('renders only left page when currentPage is the last odd page in double mode', async () => {
    render(
      <PageFlipView
        {...defaultProps}
        imageUrls={['url1', 'url2', 'url3']}
        totalPages={3}
        currentPage={3}
        displayMode="double"
      />
    )
    await waitFor(() => expect(mockFetchPreviewImage).toHaveBeenCalledWith('url3', undefined, undefined, undefined))
    expect(mockFetchPreviewImage).not.toHaveBeenCalledWith('url4', undefined, undefined, undefined)
  })

  it('shows click-to-flip navigation areas', () => {
    render(<PageFlipView {...defaultProps} />)
    expect(screen.getByLabelText('上一页')).toBeInTheDocument()
    expect(screen.getByLabelText('下一页')).toBeInTheDocument()
  })

  it('disables previous button on first page', () => {
    render(<PageFlipView {...defaultProps} currentPage={1} />)
    const prevBtn = screen.getByLabelText('上一页')
    expect(prevBtn).toHaveAttribute('aria-disabled', 'true')
  })

  it('disables next button on last page in single mode', () => {
    render(
      <PageFlipView
        {...defaultProps}
        imageUrls={['url1', 'url2', 'url3']}
        totalPages={3}
        currentPage={3}
        displayMode="single"
      />
    )
    const nextBtn = screen.getByLabelText('下一页')
    expect(nextBtn).toHaveAttribute('aria-disabled', 'true')
  })

  it('calls setCurrentPage with +1 on next click in single mode', () => {
    const setCurrentPage = vi.fn()
    render(<PageFlipView {...defaultProps} setCurrentPage={setCurrentPage} />)
    fireEvent.click(screen.getByLabelText('下一页'))
    expect(setCurrentPage).toHaveBeenCalledWith(2)
  })

  it('calls setCurrentPage with -1 on prev click in single mode', () => {
    const setCurrentPage = vi.fn()
    render(
      <PageFlipView {...defaultProps} currentPage={2} setCurrentPage={setCurrentPage} />
    )
    fireEvent.click(screen.getByLabelText('上一页'))
    expect(setCurrentPage).toHaveBeenCalledWith(1)
  })

  it('calls setCurrentPage with +2 on next click in double mode', () => {
    const setCurrentPage = vi.fn()
    render(
      <PageFlipView
        {...defaultProps}
        displayMode="double"
        setCurrentPage={setCurrentPage}
      />
    )
    fireEvent.click(screen.getByLabelText('下一页'))
    expect(setCurrentPage).toHaveBeenCalledWith(3)
  })

  it('calls setCurrentPage with -2 on prev click in double mode', () => {
    const setCurrentPage = vi.fn()
    render(
      <PageFlipView
        {...defaultProps}
        currentPage={3}
        displayMode="double"
        setCurrentPage={setCurrentPage}
      />
    )
    fireEvent.click(screen.getByLabelText('上一页'))
    expect(setCurrentPage).toHaveBeenCalledWith(1)
  })

  it('clamps next page to totalPages in double mode', () => {
    const setCurrentPage = vi.fn()
    render(
      <PageFlipView
        {...defaultProps}
        imageUrls={['url1', 'url2', 'url3']}
        totalPages={3}
        currentPage={1}
        displayMode="double"
        setCurrentPage={setCurrentPage}
      />
    )
    fireEvent.click(screen.getByLabelText('下一页'))
    expect(setCurrentPage).toHaveBeenCalledWith(3)
  })
})

// 回归：翻页方向必须在渲染期间同步推断。
// 旧实现把 setDirection 放进 useEffect，导致"先下一页、再上一页"时退出页在首次
// 提交仍朝 forward 方向飞（应为 backward）。inferPageDirection 是抽出的纯函数，
// 锁定方向推导契约——组件渲染期间调用它，确保 AnimatePresence 的 custom 与 key
// 在同一提交里一致。
describe('inferPageDirection', () => {
  it('returns forward when current > previous', () => {
    expect(inferPageDirection(3, 2)).toBe('forward')
  })

  it('returns backward when current < previous', () => {
    expect(inferPageDirection(2, 3)).toBe('backward')
  })

  it('returns null when page unchanged', () => {
    expect(inferPageDirection(3, 3)).toBeNull()
  })

  // 关键回归场景：next→prev 序列。模拟组件内 prevPage 状态的连续更新，
  // 断言每次翻页的方向都与真实翻页方向一致，没有上一帧的残留。
  it('correctly alternates direction across a next-then-prev sequence', () => {
    // 起点第 2 页
    let prev = 2
    // 下一页：2 → 3
    expect(inferPageDirection(3, prev)).toBe('forward')
    prev = 3
    // 上一页：3 → 2，必须得到 backward（旧 bug 这里首次提交仍是 forward）
    expect(inferPageDirection(2, prev)).toBe('backward')
    prev = 2
    // 再上一页：2 → 1
    expect(inferPageDirection(1, prev)).toBe('backward')
  })
})
