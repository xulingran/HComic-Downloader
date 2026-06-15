import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { usePreloadManager } from '@/hooks/usePreloadManager'

const mockFetch = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockResolvedValue({ dataUri: 'data:image/png;base64,AAA' })
  Object.defineProperty(window, 'hcomic', {
    value: { fetchPreviewImage: mockFetch },
    configurable: true,
  })
})

describe('usePreloadManager (adaptive enabled)', () => {
  // 说明：fast pace 的放大行为由 computeAdaptiveParams / buildPreloadQueue /
  // useFlipPace 三个单元的独立测试充分覆盖。编排层这里验证 enabled 分支代码
  // 被执行且不崩溃，以及 idle（无足够翻页样本）时正确退回基线。
  it('falls back to baseline under slow pace (enabled but idle)', async () => {
    const urls = Array.from({ length: 20 }, (_, i) => `u${i + 1}`)
    const { result } = renderHook(() =>
      usePreloadManager(urls, 'loaded', undefined, undefined, undefined, 4, 0, 3,
        { enabled: true }),
    )
    // 单次设 target（无足够翻页样本 → effectiveInterval=null → 退回基线 forward=4）
    act(() => result.current.setPreloadTarget(10))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(4), { timeout: 2000 })
    const calledUrls = mockFetch.mock.calls.map((c) => c[0])
    // 基线 forward=4：u11-u14，不含远页
    expect(new Set(calledUrls)).toEqual(new Set(['u11', 'u12', 'u13', 'u14']))
  })

  it('enabled hook does not crash and exposes stable API', () => {
    const urls = Array.from({ length: 10 }, (_, i) => `u${i + 1}`)
    const { result } = renderHook(() =>
      usePreloadManager(urls, 'loaded', undefined, undefined, undefined, 8, 2, 3,
        { enabled: true }),
    )
    // 验证 enabled 分支执行（useMemo 走 adaptive 路径）且返回结构完整
    expect(result.current.imageCacheRef).toBeDefined()
    expect(typeof result.current.setPreloadTarget).toBe('function')
    expect(typeof result.current.clearCache).toBe('function')
    // clearCache 在 enabled 路径下应正常工作
    act(() => result.current.clearCache())
  })
})

describe('usePreloadManager (adaptive disabled, regression)', () => {
  it('fetches forward+backward pages matching pre-refactor behavior', async () => {
    const urls = Array.from({ length: 20 }, (_, i) => `u${i + 1}`)
    const { result } = renderHook(() =>
      usePreloadManager(urls, 'loaded', undefined, undefined, undefined, 4, 2, 3),
    )
    act(() => result.current.setPreloadTarget(10))
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    // 等待队列消费完：forward 4 + backward 2 = 6
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(6), { timeout: 2000 })
    const calledUrls = mockFetch.mock.calls.map((c) => c[0])
    // forward: u11,u12,u13,u14; backward: u9,u8（顺序不严格要求，但集合必须精确）
    // 用集合对比避免字符串排序差异（'u11' < 'u8'）
    expect(calledUrls.length).toBe(6)
    expect(new Set(calledUrls)).toEqual(new Set(['u8', 'u9', 'u11', 'u12', 'u13', 'u14']))
  })

  it('does not re-fetch already cached pages on target change', async () => {
    const urls = Array.from({ length: 20 }, (_, i) => `u${i + 1}`)
    const { result } = renderHook(() =>
      usePreloadManager(urls, 'loaded', undefined, undefined, undefined, 4, 0, 3),
    )
    act(() => result.current.setPreloadTarget(5))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(4), { timeout: 2000 })
    mockFetch.mockClear()
    // target 5→6：u6,u7,u8,u9 已缓存，仅 u10（新 target+4）需抓
    act(() => result.current.setPreloadTarget(6))
    await waitFor(() => expect(mockFetch).toHaveBeenCalled(), { timeout: 2000 })
    const calledUrls = mockFetch.mock.calls.map((c) => c[0])
    expect(calledUrls).toEqual(['u10'])
  })
})
