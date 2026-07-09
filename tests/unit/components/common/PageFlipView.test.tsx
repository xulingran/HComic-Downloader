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

  // ── shrink-pageflip-trigger-zones：点击翻页热区几何契约 ──
  // 规范：reader-flip-input-gating「点击翻页热区必须限制在左右边缘条带，中央保留
  // 拖拽安全区」。左右按钮各占容器宽度 ~20%（w-1/5），中央 ~60%（flex-1）+ 安全区
  // pointer-events-none，使该区域指针事件冒泡到容器的拖拽平移 handler。
  // 实现注：jsdom 不做真实布局（getBoundingClientRect 全返回 0），故几何契约用
  // class 断言而非计算后宽度；pointer-events 穿透在 jsdom 无法模拟，安全区契约
  // 用 class 断言 + "安全区点击不翻页"行为断言固化（真实穿透由手动验证覆盖）。

  it('uses symmetric edge trigger zones (w-1/5 each), replacing old 40/60 split', () => {
    render(<PageFlipView {...defaultProps} />)
    const prevBtn = screen.getByLabelText('上一页')
    const nextBtn = screen.getByLabelText('下一页')
    // 左右条带均等宽（各 ~20%），且不再保留旧的 w-[40%] / w-[60%]
    expect(prevBtn).toHaveClass('w-1/5')
    expect(nextBtn).toHaveClass('w-1/5')
    expect(prevBtn).not.toHaveClass('w-[40%]')
    expect(nextBtn).not.toHaveClass('w-[60%]')
  })

  it('provides a central drag safe zone that is pointer-events-none', () => {
    render(<PageFlipView {...defaultProps} />)
    const safeZone = screen.getByTestId('flip-drag-safe-zone')
    // flex-1 占满中央剩余空间（~60%），pointer-events-none 让指针事件穿透到容器
    expect(safeZone).toHaveClass('flex-1')
    expect(safeZone).toHaveClass('pointer-events-none')
  })

  // 关键新行为：点击中央安全区不得触发翻页（规范场景「点击中央安全区不触发翻页」）。
  // 固化"安全区本身不绑定翻页 handler"契约——若未来误给安全区加 onClick 翻页，此测试失败。
  it('does NOT trigger page flip when clicking the central safe zone', () => {
    const setCurrentPage = vi.fn()
    render(<PageFlipView {...defaultProps} setCurrentPage={setCurrentPage} />)
    fireEvent.click(screen.getByTestId('flip-drag-safe-zone'))
    expect(setCurrentPage).not.toHaveBeenCalled()
  })

  // 边缘条带点击仍翻页，且断言真实页码值（绑定"边缘几何 + 翻页行为"，规范场景）。
  it('clicking the right edge zone advances to next page', () => {
    const setCurrentPage = vi.fn()
    render(<PageFlipView {...defaultProps} setCurrentPage={setCurrentPage} />)
    const nextBtn = screen.getByLabelText('下一页')
    expect(nextBtn).toHaveClass('w-1/5') // 确认是边缘条带
    fireEvent.click(nextBtn)
    expect(setCurrentPage).toHaveBeenCalledWith(2)
  })

  it('clicking the left edge zone goes to previous page', () => {
    const setCurrentPage = vi.fn()
    render(
      <PageFlipView {...defaultProps} currentPage={2} setCurrentPage={setCurrentPage} />
    )
    const prevBtn = screen.getByLabelText('上一页')
    expect(prevBtn).toHaveClass('w-1/5') // 确认是边缘条带
    fireEvent.click(prevBtn)
    expect(setCurrentPage).toHaveBeenCalledWith(1)
  })

  // 加载中占位回归（preview-loading-placeholder 规范）：
  // 翻页模式加载中必须渲染 ReaderPagePlaceholder（阅读器背景色 #1a1a2e + spinner），
  // 不再渲染走主题变量的 Skeleton（避免浅色主题下阅读器内出现白色色块）。
  it('renders ReaderPagePlaceholder (not Skeleton) while page is loading', () => {
    // 让 fetchPreviewImage 永远 pending，卡在加载中态
    mockFetchPreviewImage.mockReturnValue(new Promise(() => {}))
    const { container } = render(<PageFlipView {...defaultProps} />)
    // 占位背景色为阅读器深色 #1a1a2e（rgb(26,26,46)），非主题变量驱动的浅色
    const placeholder = container.querySelector('[style*="3 / 4"]') as HTMLElement | null
    expect(placeholder).not.toBeNull()
    expect(placeholder!.style.backgroundColor).toBe('rgb(26, 26, 46)')
    // 占位内有 spinner
    expect(placeholder!.querySelector('svg.animate-spin')).toBeInTheDocument()
  })

  // 回归（reader-flip-input-gating 规范）：首次挂载后滚轮必须立即可触发翻页。
  // 旧 bug：isFlipping 上锁 effect 在首次挂载也跑（setIsFlipping(true)），但
  // AnimatePresence initial={false} 首次挂载不播动画、不触发 onAnimationComplete，
  // 导致 isFlipping 永久锁死，handleWheel 的 `if (isFlipping) return` 永远吞掉滚轮。
  // 修复后上锁 effect 跳过首次挂载，滚轮立即可用。断言 setCurrentPage 被以正确
  // 页码调用（真实行为断言，非裸 mock 调用断言）。
  it('triggers page flip on wheel down after first mount (single mode)', () => {
    const setCurrentPage = vi.fn()
    const { container } = render(
      <PageFlipView {...defaultProps} currentPage={1} setCurrentPage={setCurrentPage} />
    )
    fireEvent.wheel(container.firstChild as Element, { deltaY: 100 })
    expect(setCurrentPage).toHaveBeenCalledWith(2)
  })

  it('triggers page flip on wheel down after first mount (double mode, step=2)', () => {
    const setCurrentPage = vi.fn()
    const { container } = render(
      <PageFlipView
        {...defaultProps}
        displayMode="double"
        currentPage={1}
        setCurrentPage={setCurrentPage}
      />
    )
    fireEvent.wheel(container.firstChild as Element, { deltaY: 100 })
    expect(setCurrentPage).toHaveBeenCalledWith(3)
  })

  it('triggers page flip on wheel up when not on first page', () => {
    const setCurrentPage = vi.fn()
    const { container } = render(
      <PageFlipView {...defaultProps} currentPage={2} setCurrentPage={setCurrentPage} />
    )
    fireEvent.wheel(container.firstChild as Element, { deltaY: -100 })
    expect(setCurrentPage).toHaveBeenCalledWith(1)
  })

  // 注："动画期间滚轮被丢弃"用例未补。jsdom 不执行真实 transform 动画，
  // framer-motion 的 onAnimationComplete 在 jsdom 下依赖 raf/微任务链，行为不稳定，
  // 强行 mock 会绑定实现细节且偏离真实行为。核心回归（首次挂载滚轮可用）由上面
  // 三条用例承担，"动画中丢弃"语义由代码评审 + 手动验证覆盖。
})

// reader-image-cache 规范：翻页模式叶子组件 FlipPage 取图成功后必须回写共享缓存。
// 守护"IPC 成功分支回写、缓存命中分支不回写"两条契约。
describe('PageFlipView shared cache writeback (reader-image-cache 规范)', () => {
  it('calls onCached with (index, urlHash) after IPC succeeds', async () => {
    mockFetchPreviewImage.mockResolvedValue({ urlHash: 'd'.repeat(64) })
    const onCached = vi.fn()
    render(<PageFlipView {...defaultProps} onCached={onCached} />)
    await waitFor(() => expect(onCached).toHaveBeenCalledWith(0, 'd'.repeat(64)))
  })

  it('does NOT call onCached when cache hits (cachedUrlHash present)', async () => {
    // 命中分支：imageCacheRef 预置 index 0 的 urlHash，FlipPage 直接采用，不回写、不发 IPC
    const cachedMap = new Map<number, string>([[0, 'e'.repeat(64)]])
    mockFetchPreviewImage.mockResolvedValue({ urlHash: 'd'.repeat(64) })
    const onCached = vi.fn()
    render(
      <PageFlipView
        {...defaultProps}
        imageCacheRef={{ current: cachedMap }}
        onCached={onCached}
      />
    )
    await new Promise<void>((r) => setTimeout(r, 20))
    expect(onCached).not.toHaveBeenCalled()
    // 缓存命中分支不应发起 IPC
    expect(mockFetchPreviewImage).not.toHaveBeenCalled()
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
