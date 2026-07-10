import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ComicInfo } from '@shared/types'
import { prefetchCovers } from '@/lib/cover-prefetch'
import { useCoverImage, coverOutcome, pendingRequests } from '@/hooks/useCoverImage'

/**
 * 集成测试：验证 prefetchCovers 预载后 useCoverImage 命中 memo 跳过 IPC，
 * 以及 contextKey 中断后在途结果仍写入 coverOutcome（不丢弃）。
 *
 * 组合：真实 prefetchCovers（含真实 fetchCoverToMemo + 真实 coverOutcome memo）
 *       + 真实 useCoverImage（无 containerRef → 立即加载，不走 IntersectionObserver）
 *       + mock window.hcomic.fetchCover（用 deferred 控制 resolve 时机）
 *
 * 守护的核心行为：预载写入 coverOutcome 后，useCoverImage 挂载时命中 memo，
 * 不再调用 fetchCover IPC——这是封面预载体验收益（翻页秒出）的根本保证。
 *
 * timers 策略：prefetchCovers 依赖 scheduleIdle（走 setTimeout），用 fake timers
 * 驱动 idle 调度后切回 real timers，让 useCoverImage 的 React effect 正常 flush。
 */

function makeDeferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

function makeComic(coverUrl: string): ComicInfo {
  return {
    id: coverUrl,
    title: 'test',
    coverUrl,
    sourceSite: 'test',
    sourceId: 'test',
    comicSource: 'hcomic',
  } as unknown as ComicInfo
}

/** mock fetchCover 返回 deferred，记录调用次数。 */
function mockFetchCover() {
  const deferreds: Array<{ promise: Promise<{ urlHash: string }>; resolve: (v: { urlHash: string }) => void }> = []
  const spy = vi.fn((_url: string) => {
    const d = makeDeferred<{ urlHash: string }>()
    deferreds.push(d)
    return d.promise
  })
  vi.stubGlobal('hcomic', { fetchCover: spy })
  return {
    spy,
    deferred: (i: number) => deferreds[i],
    callCount: () => spy.mock.calls.length,
  }
}

/** 驱动 prefetchCovers 的 idle 调度并切回 real timers。 */
async function flushPrefetchIdle() {
  vi.advanceTimersByTime(0)
  await vi.runAllTimersAsync()
  vi.useRealTimers()
}

describe('prefetchCovers ↔ useCoverImage 集成', () => {
  beforeEach(() => {
    coverOutcome.clear()
    pendingRequests.clear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    coverOutcome.clear()
    pendingRequests.clear()
  })

  it('预载后 useCoverImage 命中 coverOutcome 跳过 IPC，coverSrc 为协议 URL', async () => {
    const { spy, deferred } = mockFetchCover()
    const url = 'https://a.com/cover1.jpg'
    const comics = [makeComic(url)]

    // 1. 触发封面预载
    const prefetchP = prefetchCovers(comics, { signal: new AbortController().signal, sfwMode: false })
    await flushPrefetchIdle()

    // fetchCover 已被预载调用 1 次
    expect(spy).toHaveBeenCalledTimes(1)

    // 2. resolve 预载请求，urlHash 写入 coverOutcome
    deferred(0).resolve({ urlHash: 'prefetched-hash-1' })
    await prefetchP
    expect(coverOutcome.get(url)).toBe('prefetched-hash-1')

    // 3. 挂载 useCoverImage（无 containerRef → 立即加载，不走 IntersectionObserver）
    //    应命中 coverOutcome memo，不再调用 fetchCover IPC
    const { result } = renderHook(() => useCoverImage(url, undefined, false))

    // coverSrc 应为 app-image://cover/{urlHash}
    await waitFor(() => {
      expect(result.current.coverSrc).toBe('app-image://cover/prefetched-hash-1')
    })

    // fetchCover 调用数仍为 1（预载那次），useCoverImage 未新增
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('未预载时 useCoverImage 正常发起 fetchCover IPC', async () => {
    const { spy, deferred } = mockFetchCover()
    const url = 'https://a.com/cover2.jpg'

    // 切回 real timers 让 React effect 正常执行
    vi.useRealTimers()

    // 直接挂载 useCoverImage，无预载
    const { result } = renderHook(() => useCoverImage(url, undefined, false))

    // 发起 1 次 IPC
    await waitFor(() => {
      expect(spy).toHaveBeenCalledTimes(1)
    })

    deferred(0).resolve({ urlHash: 'ondemand-hash-2' })
    await waitFor(() => {
      expect(result.current.coverSrc).toBe('app-image://cover/ondemand-hash-2')
    })
  })

  it('contextKey 中断后在途请求结果仍写入 coverOutcome，后续 useCoverImage 命中', async () => {
    const { spy, deferred, callCount } = mockFetchCover()
    const controller = new AbortController()
    const comics = Array.from({ length: 6 }, (_, i) => makeComic(`https://a.com/${i}.jpg`))

    // 触发预载，2 个在途
    const prefetchP = prefetchCovers(comics, { signal: controller.signal, sfwMode: false })
    await flushPrefetchIdle()
    expect(callCount()).toBe(2)

    // 中断
    controller.abort()

    // 在途请求完成 → 结果写入 coverOutcome（不丢弃）
    deferred(0).resolve({ urlHash: 'h0' })
    deferred(1).resolve({ urlHash: 'h1' })
    await prefetchP

    expect(coverOutcome.get('https://a.com/0.jpg')).toBe('h0')
    expect(coverOutcome.get('https://a.com/1.jpg')).toBe('h1')
    // 剩余 4 个未发起
    expect(callCount()).toBe(2)

    // 后续 useCoverImage 对已预载的 URL 命中 memo，不发 IPC
    const { result } = renderHook(() => useCoverImage('https://a.com/0.jpg', undefined, false))
    await waitFor(() => {
      expect(result.current.coverSrc).toBe('app-image://cover/h0')
    })
    // fetchCover 调用数仍为 2（预载的在途 2 次），useCoverImage 未新增
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('预载与按需加载对同一 URL 复用 in-flight promise', async () => {
    const { spy, deferred, callCount } = mockFetchCover()
    const url = 'https://a.com/shared.jpg'
    const comics = [makeComic(url)]

    // 1. 触发预载，fetchCover 在途（未 resolve）
    const prefetchP = prefetchCovers(comics, { signal: new AbortController().signal, sfwMode: false })
    await flushPrefetchIdle()
    expect(callCount()).toBe(1) // 预载发起 1 次

    // 2. 在预载在途期间挂载 useCoverImage——应复用 pendingRequests 中的 promise
    const { result } = renderHook(() => useCoverImage(url, undefined, false))
    // real timers 已由 flushPrefetchIdle 切回；useCoverImage 的 fetchCoverToMemo 命中 pendingRequests
    expect(callCount()).toBe(1) // 未新增 IPC

    // 3. resolve 后两者都拿到同一 urlHash
    await act(async () => {
      deferred(0).resolve({ urlHash: 'shared-hash' })
      await prefetchP
    })
    await waitFor(() => {
      expect(result.current.coverSrc).toBe('app-image://cover/shared-hash')
    })
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
