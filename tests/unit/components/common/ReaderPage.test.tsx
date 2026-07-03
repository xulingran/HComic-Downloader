import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
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
