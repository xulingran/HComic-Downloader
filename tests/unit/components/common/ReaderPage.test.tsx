import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { ReaderPage } from '@/components/ReaderPage'

const mockFetchPreviewImage = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'hcomic', {
    value: { fetchPreviewImage: mockFetchPreviewImage },
    writable: true,
    configurable: true,
  })
})

// ReaderPage 用 IntersectionObserver 决定是否发起加载。
// 这里提供一个"永不触发可见"的 mock，让未进入视口分支可被稳定测试；
// 加载中分支通过 priority=true 绕过 isVisible 门控触发请求。
class MockIntersectionObserver {
  readonly root: Element | null = null
  readonly rootMargin: string = ''
  readonly thresholds: ReadonlyArray<number> = []
  constructor() {}
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return [] }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).IntersectionObserver = MockIntersectionObserver

describe('ReaderPage loading placeholder (preview-loading-placeholder 规范)', () => {
  it('shows striped lazy placeholder when not visible and not priority', () => {
    const { container } = render(
      <ReaderPage url="url1" index={0} />
    )
    // 横纹占位：repeating-linear-gradient，不是 ReaderPagePlaceholder 的纯色 #1a1a2e
    const striped = container.querySelector('[style*="repeating-linear-gradient"]')
    expect(striped).toBeInTheDocument()
    // 不应发起请求（懒加载）
    expect(mockFetchPreviewImage).not.toHaveBeenCalled()
    // 不应有 spinner
    expect(container.querySelector('svg.animate-spin')).not.toBeInTheDocument()
  })

  it('renders ReaderPagePlaceholder while loading (priority=true, request pending)', () => {
    // 永远 pending，卡在加载中态
    mockFetchPreviewImage.mockReturnValue(new Promise(() => {}))
    const { container } = render(
      <ReaderPage url="url1" index={0} priority />
    )
    // 加载中：背景色为阅读器深色 #1a1a2e（rgb(26,26,46)），非主题变量浅色
    const placeholder = container.querySelector('[style*="3 / 4"]') as HTMLElement | null
    expect(placeholder).not.toBeNull()
    expect(placeholder!.style.backgroundColor).toBe('rgb(26, 26, 46)')
    // 占位内有 spinner
    expect(placeholder!.querySelector('svg.animate-spin')).toBeInTheDocument()
    // 不应出现横纹（那是未进入视口的懒加载占位）
    expect(container.querySelector('[style*="repeating-linear-gradient"]')).not.toBeInTheDocument()
  })
})

// reader-image-cache 规范：叶子组件取图成功后必须回写共享缓存。
// 这些用例守护"回写"这一真实行为——验证 onCached 被以正确的 (index, urlHash)
// 调用，且缓存命中分支不重复回写（值本就读自共享缓存）。
describe('ReaderPage shared cache writeback (reader-image-cache 规范)', () => {
  it('calls onCached with (index, urlHash) after fetch succeeds', async () => {
    mockFetchPreviewImage.mockResolvedValue({ urlHash: 'a'.repeat(64) })
    const onCached = vi.fn()
    render(
      <ReaderPage url="url1" index={2} priority onCached={onCached} />
    )
    await waitFor(() => expect(onCached).toHaveBeenCalledWith(2, 'a'.repeat(64)))
  })

  it('does NOT call onCached when cachedUrlHash is provided (cache hit branch)', async () => {
    // 缓存命中分支：cachedUrlHash 已有值，组件直接采用，不发起 IPC、不回写
    mockFetchPreviewImage.mockResolvedValue({ urlHash: 'a'.repeat(64) })
    const onCached = vi.fn()
    render(
      <ReaderPage url="url1" index={0} priority cachedUrlHash={'b'.repeat(64)} onCached={onCached} />
    )
    // 给可能的状态更新留窗口
    await new Promise<void>((r) => setTimeout(r, 20))
    expect(onCached).not.toHaveBeenCalled()
    // 关键：缓存命中分支不应发起 IPC（值来自共享缓存）
    expect(mockFetchPreviewImage).not.toHaveBeenCalled()
  })
})
