import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { usePreloadManager } from '@/hooks/usePreloadManager'

const mockFetch = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockResolvedValue({ urlHash: 'a'.repeat(64) })
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

  it('scroll simulation: preloadedRanges eventually updates after consecutive target changes', async () => {
    // 滚动模式下 currentPage 连续变化 → setPreloadTarget 连续调用。
    // 去抖后只有最后一次（停顿后）触发预加载，preloadedRanges 反映最终 target 区间。
    const urls = Array.from({ length: 20 }, (_, i) => `u${i + 1}`)
    const { result } = renderHook(() =>
      usePreloadManager(urls, 'loaded', undefined, undefined, undefined, 4, 0, 3),
    )
    // 模拟连续滚动（每步之间让 microtask 跑完，避免纯同步 batch）
    for (let p = 1; p <= 8; p++) {
      await act(async () => {
        result.current.setPreloadTarget(p)
        await Promise.resolve()
      })
    }
    // 最终应缓存到 target=8 的 forward 范围（u9-u12）并反映在 preloadedRanges
    await waitFor(() => {
      expect(result.current.preloadedRanges.length).toBeGreaterThan(0)
    }, { timeout: 3000 })
    // 至少有一个区间落在 target=8 的 forward 区域 [9,12]
    const coversForward = result.current.preloadedRanges.some(
      (r) => r.start <= 12 && r.end >= 9,
    )
    expect(coversForward).toBe(true)
  })

  it('param changes (forward/alternation) do not restart preload effect for the same target — fetched pages are not re-fetched', async () => {
    // 验证 paramsRef 隔离：adaptive 开启时 forward/alternation 抖动（FAST_MS 边界）
    // 不应重启 effect 重复抓取已缓存页。params 只在 target 变化时通过 ref 读取。
    // 这里用「重渲染并切换 adaptive 开关」模拟 params 变化：同一 target 下不重复 fetch。
    const urls = Array.from({ length: 20 }, (_, i) => `u${i + 1}`)
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        usePreloadManager(urls, 'loaded', undefined, undefined, undefined, 4, 0, 3,
          { enabled }),
      { initialProps: { enabled: false } },
    )
    act(() => result.current.setPreloadTarget(5))
    // 基线 forward=4：u6-u9
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(4), { timeout: 2000 })
    const fetchedAfterFirst = mockFetch.mock.calls.length
    expect(new Set(mockFetch.mock.calls.map((c) => c[0])))
      .toEqual(new Set(['u6', 'u7', 'u8', 'u9']))

    // 切换 adaptive 开关 → params 从 {forward:4,alt:false} 变为 adaptive 计算值。
    // effect 不应重启：target 未变，已缓存的 u6-u9 不应被重复抓取。
    mockFetch.mockClear()
    rerender({ enabled: true })
    // 给可能的 effect 重启留出时间窗口；若无重启则 fetch 次数保持 0
    await new Promise<void>((r) => setTimeout(r, 50))
    expect(mockFetch).not.toHaveBeenCalled()
    expect(fetchedAfterFirst).toBe(4)
  })

  it('cached page content survives params jitter — already-loaded pages remain in cache (no data loss)', async () => {
    // 更强的不变量：params 抖动不仅不应重复 fetch，已写入缓存的页面 urlHash 必须保持可读。
    // 这锁定的是「用户视角页面不丢失」而非仅「没多调一次 fetch」。对应 regression-guards spec。
    const urls = Array.from({ length: 20 }, (_, i) => `u${i + 1}`)
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        usePreloadManager(urls, 'loaded', undefined, undefined, undefined, 4, 0, 3,
          { enabled }),
      { initialProps: { enabled: false } },
    )
    act(() => result.current.setPreloadTarget(5))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(4), { timeout: 2000 })
    // 缓存 snapshot：target=5 的基线 forward 覆盖 u6-u9（0-based 索引 5-8）
    const cacheBefore = new Map(result.current.imageCacheRef.current)
    expect(cacheBefore.size).toBe(4)
    cacheBefore.forEach((v) => expect(v).toBeTruthy())

    // 触发 params 抖动（切换 adaptive 开关）
    rerender({ enabled: true })
    await new Promise<void>((r) => setTimeout(r, 50))

    // 不变量：抖动后缓存内容必须完整保留，不得有页丢失
    const cacheAfter = result.current.imageCacheRef.current
    expect(cacheAfter.size).toBeGreaterThanOrEqual(cacheBefore.size)
    cacheBefore.forEach((urlHash, idx) => {
      expect(cacheAfter.get(idx)).toBe(urlHash)
    })
  })
})

describe('usePreloadManager (adaptive enabled, fast pace drives boost)', () => {
  // 用真实 timer + await 微延迟制造真实 < FAST_MS(700ms) 翻页间隔，
  // 让 useFlipPace 收集足够样本触发 isFlippingFast → computeAdaptiveParams 放大 forward。
  // 这验证了 adaptive 全链路：翻页节奏 → useFlipPace → computeAdaptiveParams → 放大队列。
  const tick = () => new Promise<void>((r) => setTimeout(r, 10))

  it('boosts forward and reaches far pages under rapid forward flipping', async () => {
    const urls = Array.from({ length: 40 }, (_, i) => `u${i + 1}`)
    // base forward=4, concurrency=3 → 极快时 forward 放大到 min(4*2.5,30)=10
    const { result } = renderHook(() =>
      usePreloadManager(urls, 'loaded', undefined, undefined, undefined, 4, 0, 3,
        { enabled: true }),
    )
    // 连续前进翻页 6 次（每次间隔 ~10ms，远 < FAST_MS），产生 5 个间隔样本
    for (let p = 1; p <= 6; p++) {
      await act(async () => {
        result.current.setPreloadTarget(p)
        await tick()
      })
    }
    // 放大后 forward=10，target=6 的 forward 范围达 u16（基线 forward=4 只到 u10）
    await waitFor(() => expect(mockFetch).toHaveBeenCalled(), { timeout: 2000 })
    await waitFor(
      () => expect(mockFetch.mock.calls.length).toBeGreaterThan(4),
      { timeout: 3000 },
    )
    const calledUrls = mockFetch.mock.calls.map((c) => c[0])
    const maxPage = Math.max(...calledUrls.map((u) => Number(u.slice(1))))
    // 基线 forward=4 时 target=6 最远到 u10；放大后应到达 u11 及以上
    expect(maxPage).toBeGreaterThanOrEqual(11)
  })
})
