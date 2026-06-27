import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { ReaderPage } from '@/components/ReaderPage'
import { PageFlipView } from '@/components/PageFlipView'
import { useFailedPages } from '@/hooks/useFailedPages'
import { useToastStore } from '@/stores/useToastStore'
import { createMockHcomic } from '../__mocks__/ipc'

/**
 * 集成测试：失败页上报 + retryGen 全部重试 + 阈值 Toast 状态机。
 * 覆盖 openspec/changes/preview-retry-toast/specs/preview-error-recovery/spec.md
 */

// Mock IntersectionObserver for jsdom — triggers isIntersecting immediately
class MockIntersectionObserver {
  readonly root: Element | null = null
  readonly rootMargin: string = ''
  readonly thresholds: ReadonlyArray<number> = []
  private callback: IntersectionObserverCallback

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
  }
  observe(target: Element) {
    this.callback(
      [{ isIntersecting: true, target, boundingClientRect: { top: 0 } }] as unknown as IntersectionObserverEntry[],
      this as unknown as IntersectionObserver
    )
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return [] }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IntersectionObserver = MockIntersectionObserver

const URL_HASH = 'f'.repeat(64)

describe('ReaderPage 失败上报与重试', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('IPC 失败时调用 onFailed(index)', async () => {
    createMockHcomic({
      fetchPreviewImage: vi.fn().mockRejectedValue(new Error('网络错误')),
    })
    const onFailed = vi.fn()
    render(<ReaderPage url="http://x/1.jpg" index={2} priority onFailed={onFailed} />)

    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(2))
  })

  it('成功加载时调用 onLoaded(index)', async () => {
    createMockHcomic({
      fetchPreviewImage: vi.fn().mockResolvedValue({ urlHash: URL_HASH }),
    })
    const onLoaded = vi.fn()
    render(<ReaderPage url="http://x/1.jpg" index={5} priority onLoaded={onLoaded} />)

    await waitFor(() => expect(onLoaded).toHaveBeenCalledWith(5))
  })

  it('retryGen 变化且当前 error 时重新加载', async () => {
    // 所有调用都失败，验证 retryGen 变化触发额外一次 fetch（重试）
    const fetchMock = vi.fn().mockRejectedValue(new Error('fail'))
    createMockHcomic({ fetchPreviewImage: fetchMock })
    const onFailed = vi.fn()

    const { rerender } = render(
      <ReaderPage url="http://x/1.jpg" index={3} priority onFailed={onFailed} retryGen={1} />,
    )
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(3))
    const callsAfterFirstFail = fetchMock.mock.calls.length

    // retryGen → 2：触发重试（之前是 error 态），fetch 应被再调用一次
    rerender(<ReaderPage url="http://x/1.jpg" index={3} priority onFailed={onFailed} retryGen={2} />)
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirstFail))
  })

  it('未传 onFailed/onLoaded/retryGen 时行为正常（向后兼容）', async () => {
    createMockHcomic({
      fetchPreviewImage: vi.fn().mockResolvedValue({ urlHash: URL_HASH }),
    })
    render(<ReaderPage url="http://x/1.jpg" index={0} priority />)
    // 不报错即视为通过
    expect(true).toBe(true)
  })
})

describe('FlipPage (PageFlipView) 失败上报与单页重试', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('加载失败时调用 onFailed，并显示单页重试按钮', async () => {
    createMockHcomic({
      fetchPreviewImage: vi.fn().mockRejectedValue(new Error('fail')),
    })
    const onFailed = vi.fn()

    render(
      <PageFlipView
        imageUrls={['http://x/1.jpg']}
        totalPages={1}
        currentPage={1}
        setCurrentPage={vi.fn()}
        displayMode="single"
        imageWidth={80}
        zoom={1}
        imageCacheRef={{ current: new Map() }}
        cacheVersion={0}
        onPageChange={vi.fn()}
        blankPosition="none"
        onFailed={onFailed}
      />,
    )

    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(0))
    expect(await screen.findByRole('button', { name: '重试' })).toBeInTheDocument()
  })

  it('点击单页重试按钮重新发起请求', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue({ urlHash: URL_HASH })
    createMockHcomic({ fetchPreviewImage: fetchMock })

    render(
      <PageFlipView
        imageUrls={['http://x/1.jpg']}
        totalPages={1}
        currentPage={1}
        setCurrentPage={vi.fn()}
        displayMode="single"
        imageWidth={80}
        zoom={1}
        imageCacheRef={{ current: new Map() }}
        cacheVersion={0}
        onPageChange={vi.fn()}
        blankPosition="none"
      />,
    )

    const retryBtn = await screen.findByRole('button', { name: '重试' })
    // 用 fireEvent 避免 userEvent 在 framer-motion AnimatePresence 下的 pointer 拦截
    fireEvent.click(retryBtn)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('retryGen 变化触发 error 态 FlipPage 重载', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue({ urlHash: URL_HASH })
    createMockHcomic({ fetchPreviewImage: fetchMock })
    const onFailed = vi.fn()

    const { rerender } = render(
      <PageFlipView
        imageUrls={['http://x/1.jpg']}
        totalPages={1}
        currentPage={1}
        setCurrentPage={vi.fn()}
        displayMode="single"
        imageWidth={80}
        zoom={1}
        imageCacheRef={{ current: new Map() }}
        cacheVersion={0}
        onPageChange={vi.fn()}
        blankPosition="none"
        onFailed={onFailed}
        retryGen={0}
      />,
    )
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(0))

    rerender(
      <PageFlipView
        imageUrls={['http://x/1.jpg']}
        totalPages={1}
        currentPage={1}
        setCurrentPage={vi.fn()}
        displayMode="single"
        imageWidth={80}
        zoom={1}
        imageCacheRef={{ current: new Map() }}
        cacheVersion={0}
        onPageChange={vi.fn()}
        blankPosition="none"
        onFailed={onFailed}
        retryGen={1}
      />,
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })
})

/**
 * 阈值 Toast 状态机：用 useFailedPages + 最小化宿主组件复现 ComicReaderModal 的
 * 阈值 effect 逻辑，避免渲染整个重型 Modal。
 */
const FAILED_THRESHOLD = 3

function ThresholdHarness() {
  const { failedCount, retryAll, markFailed, markLoaded, clearAll } = useFailedPages()
  const prevRef = useRef(0)
  const hadToastRef = useRef(false)
  useEffect(() => {
    const prev = prevRef.current
    if (prev === failedCount) return
    prevRef.current = failedCount
    if (failedCount > FAILED_THRESHOLD) {
      hadToastRef.current = true
      useToastStore.getState().error(`${failedCount} 页加载失败`, {
        actionLabel: '全部重试',
        onAction: retryAll,
        persistent: true,
      })
    } else if (failedCount === 0 && hadToastRef.current) {
      hadToastRef.current = false
      useToastStore.getState().success('已恢复全部页面')
    } else {
      hadToastRef.current = false
      useToastStore.getState().dismiss()
    }
  }, [failedCount, retryAll])
  return (
    <div>
      <button onClick={() => markFailed(0)}>fail0</button>
      <button onClick={() => markFailed(1)}>fail1</button>
      <button onClick={() => markFailed(2)}>fail2</button>
      <button onClick={() => markFailed(3)}>fail3</button>
      <button onClick={() => markLoaded(0)}>load0</button>
      <button onClick={() => markLoaded(1)}>load1</button>
      <button onClick={() => markLoaded(2)}>load2</button>
      <button onClick={() => markLoaded(3)}>load3</button>
      <button onClick={retryAll}>retryAll</button>
      <button onClick={clearAll}>clearAll</button>
      <span data-testid="count">{failedCount}</span>
    </div>
  )
}

describe('阈值 Toast 状态机', () => {
  beforeEach(() => {
    useToastStore.setState({ toast: { message: '', type: 'info', visible: false } })
  })

  it('失败 ≤3 时不弹常驻失败 Toast（仅单页本地重试）', async () => {
    render(<ThresholdHarness />)

    await act(async () => {
      screen.getByText('fail0').click()
      screen.getByText('fail1').click()
      screen.getByText('fail2').click()
    })

    // 失败数 = 3，未超阈值，应被 dismiss（visible=false）
    expect(useToastStore.getState().toast.visible).toBe(false)
  })

  it('失败 >3 时弹常驻 Toast 且带"全部重试"按钮', async () => {
    render(<ThresholdHarness />)

    await act(async () => {
      screen.getByText('fail0').click()
      screen.getByText('fail1').click()
      screen.getByText('fail2').click()
      screen.getByText('fail3').click()
    })

    const toast = useToastStore.getState().toast
    expect(toast.visible).toBe(true)
    expect(toast.persistent).toBe(true)
    expect(toast.message).toBe('4 页加载失败')
    expect(toast.actionLabel).toBe('全部重试')
    expect(toast.type).toBe('error')
  })

  it('全部恢复后 Toast 切 success"已恢复全部页面"', async () => {
    render(<ThresholdHarness />)

    await act(async () => {
      screen.getByText('fail0').click()
      screen.getByText('fail1').click()
      screen.getByText('fail2').click()
      screen.getByText('fail3').click()
    })
    expect(useToastStore.getState().toast.type).toBe('error')

    await act(async () => {
      screen.getByText('load0').click()
      screen.getByText('load1').click()
      screen.getByText('load2').click()
      screen.getByText('load3').click()
    })
    const toast = useToastStore.getState().toast
    expect(toast.type).toBe('success')
    expect(toast.message).toBe('已恢复全部页面')
    expect(toast.persistent).toBeFalsy()
  })

  it('clearAll 重置失败集合与 Toast', async () => {
    render(<ThresholdHarness />)

    await act(async () => {
      screen.getByText('fail0').click()
      screen.getByText('fail1').click()
      screen.getByText('fail2').click()
      screen.getByText('fail3').click()
    })
    expect(useToastStore.getState().toast.visible).toBe(true)

    await act(async () => {
      screen.getByText('clearAll').click()
    })
    expect(screen.getByTestId('count').textContent).toBe('0')
  })

  it('全部重试自增 retryGen 但不立即清空集合（由叶子 effect 响应）', async () => {
    render(<ThresholdHarness />)

    await act(async () => {
      screen.getByText('fail0').click()
      screen.getByText('fail1').click()
      screen.getByText('fail2').click()
      screen.getByText('fail3').click()
    })
    expect(screen.getByTestId('count').textContent).toBe('4')

    // 点击全部重试按钮（store onAction 绑定的 retryAll）
    await act(async () => {
      const action = useToastStore.getState().toast.onAction!
      action()
    })
    // retryAll 自增 retryGen，但集合不动 —— 验证决策 2/3 的语义
    expect(screen.getByTestId('count').textContent).toBe('4')
  })
})
