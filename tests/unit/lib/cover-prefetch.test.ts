import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ComicInfo } from '@shared/types'
import { prefetchCovers } from '@/lib/cover-prefetch'
import { coverOutcome, pendingRequests, fetchCoverToMemo } from '@/hooks/useCoverImage'

/**
 * 封面预加载工具的单元测试。
 *
 * 测试策略：mock window.hcomic.fetchCover 为 deferred promise，通过控制 resolve
 * 时机验证限并发上限、SFW 门控、contextKey 中断、memo 命中跳过、dedup 复用、
 * idle 延迟启动等真实行为——而非仅断言 mock 被调用。
 */

/** 构造 deferred promise，测试可控制 resolve 时机以验证并发与时序。 */
function makeDeferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 构造 ComicInfo（仅需 coverUrl 字段用于封面预载测试）。 */
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

/** mock fetchCover，返回 deferred 供测试控制 resolve。 */
function mockFetchCoverDeferred() {
  const deferreds: Array<{ promise: Promise<{ urlHash: string }>; resolve: (v: { urlHash: string }) => void }> = []
  const spy = vi.fn((_url: string) => {
    const d = makeDeferred<{ urlHash: string }>()
    deferreds.push(d)
    return d.promise
  })
  vi.stubGlobal('hcomic', { fetchCover: spy })
  return {
    spy,
    /** 第 i 次 fetchCover 调用的 deferred（0-based）。 */
    deferred: (i: number) => deferreds[i],
    /** 当前已发起的 fetchCover 调用数。 */
    callCount: () => spy.mock.calls.length,
  }
}

describe('prefetchCovers', () => {
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

  describe('SFW 门控', () => {
    it('SFW 开启时不发起任何 fetchCover IPC', async () => {
      const { callCount } = mockFetchCoverDeferred()
      const comics = [makeComic('https://a.com/1.jpg'), makeComic('https://a.com/2.jpg')]

      await prefetchCovers(comics, { signal: new AbortController().signal, sfwMode: true })

      // 推进 idle timer 确保即使调度也不发 IPC
      vi.advanceTimersByTime(0)
      await vi.runAllTimersAsync()
      expect(callCount()).toBe(0)
      // coverOutcome 不被写入
      expect(coverOutcome.size).toBe(0)
    })

    it('SFW 关闭时正常发起 fetchCover IPC 并写入 coverOutcome', async () => {
      const { spy, deferred } = mockFetchCoverDeferred()
      const comics = [makeComic('https://a.com/1.jpg')]

      const p = prefetchCovers(comics, { signal: new AbortController().signal, sfwMode: false })
      vi.advanceTimersByTime(0) // 触发 idle 调度
      await vi.runAllTimersAsync()
      deferred(0).resolve({ urlHash: 'hash1' })
      await p

      expect(spy).toHaveBeenCalledWith('https://a.com/1.jpg')
      expect(coverOutcome.get('https://a.com/1.jpg')).toBe('hash1')
    })
  })

  describe('限并发', () => {
    it('同一时刻 in-flight 的 fetchCover 不超过 2', async () => {
      const { spy, deferred, callCount } = mockFetchCoverDeferred()
      const comics = Array.from({ length: 10 }, (_, i) => makeComic(`https://a.com/${i}.jpg`))

      const p = prefetchCovers(comics, { signal: new AbortController().signal, sfwMode: false })
      vi.advanceTimersByTime(0) // 触发 idle
      await vi.runAllTimersAsync()

      // 10 个 URL，并发 2：idle 调度后应只发起前 2 个
      expect(callCount()).toBe(2)

      // 循环 resolve：每次释放 slot 后会派发新请求，直到全部 10 个完成
      for (let i = 0; i < 10; i++) {
        deferred(i).resolve({ urlHash: `h${i}` })
        await vi.runAllTimersAsync()
      }
      await p
      expect(spy).toHaveBeenCalledTimes(10)
    })

    it('slot 释放后后续 URL 依次补入', async () => {
      const { spy, deferred, callCount } = mockFetchCoverDeferred()
      const comics = Array.from({ length: 4 }, (_, i) => makeComic(`https://a.com/${i}.jpg`))

      const p = prefetchCovers(comics, { signal: new AbortController().signal, sfwMode: false })
      vi.advanceTimersByTime(0)
      await vi.runAllTimersAsync()
      expect(callCount()).toBe(2) // 前 2 个在途

      // 释放第 1 个 slot → 第 3 个补入
      deferred(0).resolve({ urlHash: 'h0' })
      await vi.runAllTimersAsync()
      expect(callCount()).toBe(3)

      // 释放第 2 个 slot → 第 4 个补入
      deferred(1).resolve({ urlHash: 'h1' })
      await vi.runAllTimersAsync()
      expect(callCount()).toBe(4)

      deferred(2).resolve({ urlHash: 'h2' })
      deferred(3).resolve({ urlHash: 'h3' })
      await p
      expect(spy).toHaveBeenCalledTimes(4)
    })
  })

  describe('contextKey 中断', () => {
    it('abort 后停止发起新 fetchCover，在途请求结果仍写入 coverOutcome', async () => {
      const { deferred, callCount } = mockFetchCoverDeferred()
      const controller = new AbortController()
      const comics = Array.from({ length: 6 }, (_, i) => makeComic(`https://a.com/${i}.jpg`))

      const p = prefetchCovers(comics, { signal: controller.signal, sfwMode: false })
      vi.advanceTimersByTime(0)
      await vi.runAllTimersAsync()
      expect(callCount()).toBe(2) // 前 2 个在途

      controller.abort() // 中断

      // 在途请求完成 → 结果写入 coverOutcome（不丢弃）
      deferred(0).resolve({ urlHash: 'h0' })
      deferred(1).resolve({ urlHash: 'h1' })
      await p

      expect(coverOutcome.get('https://a.com/0.jpg')).toBe('h0')
      expect(coverOutcome.get('https://a.com/1.jpg')).toBe('h1')
      // 剩余 4 个 URL 未发起
      expect(callCount()).toBe(2)
    })
  })

  describe('coverOutcome memo 命中跳过', () => {
    it('URL 已有 urlHash 时不发 IPC', async () => {
      const { deferred, callCount } = mockFetchCoverDeferred()
      coverOutcome.set('https://a.com/1.jpg', 'existing-hash')
      const comics = [makeComic('https://a.com/1.jpg'), makeComic('https://a.com/2.jpg')]

      const p = prefetchCovers(comics, { signal: new AbortController().signal, sfwMode: false })
      vi.advanceTimersByTime(0)
      await vi.runAllTimersAsync()

      // 只有 URL 2 发起 IPC，URL 1 命中 memo 跳过
      expect(callCount()).toBe(1)
      deferred(0).resolve({ urlHash: 'h2' })
      await p
    })

    it('URL 标记为 null（失败）时不发 IPC，避免重试风暴', async () => {
      const { callCount } = mockFetchCoverDeferred()
      coverOutcome.set('https://a.com/1.jpg', null)
      const comics = [makeComic('https://a.com/1.jpg')]

      const p = prefetchCovers(comics, { signal: new AbortController().signal, sfwMode: false })
      vi.advanceTimersByTime(0)
      await vi.runAllTimersAsync()

      expect(callCount()).toBe(0)
      await p
    })
  })

  describe('pendingRequests 去重复用', () => {
    it('URL 的 promise 已 in-flight 时复用而非新建 IPC', async () => {
      const { spy, deferred, callCount } = mockFetchCoverDeferred()
      const url = 'https://a.com/shared.jpg'

      // 先手动发起一个 in-flight 请求占据 pendingRequests
      const inflight = fetchCoverToMemo(url)
      vi.advanceTimersByTime(0)
      await vi.runAllTimersAsync()
      expect(callCount()).toBe(1) // 已发起 1 次

      // prefetchCovers 对同一 URL 应复用 in-flight promise，不发新 IPC
      const comics = [makeComic(url)]
      const p = prefetchCovers(comics, { signal: new AbortController().signal, sfwMode: false })
      vi.advanceTimersByTime(0)
      await vi.runAllTimersAsync()
      expect(callCount()).toBe(1) // 仍是 1，未新增

      deferred(0).resolve({ urlHash: 'shared-hash' })
      await Promise.all([inflight, p])

      expect(spy).toHaveBeenCalledTimes(1)
      expect(coverOutcome.get(url)).toBe('shared-hash')
    })
  })

  describe('scheduleIdle 延迟启动', () => {
    it('fetchCover 不在 prefetchCovers 同步调用栈中立即发起', () => {
      const { callCount } = mockFetchCoverDeferred()
      const comics = [makeComic('https://a.com/1.jpg')]

      prefetchCovers(comics, { signal: new AbortController().signal, sfwMode: false })
      // 同步调用后、未推进 idle timer 前，不应发起 IPC
      expect(callCount()).toBe(0)

      // 推进 idle timer 后才发起
      vi.advanceTimersByTime(0)
      expect(callCount()).toBe(1)
    })
  })

  describe('空输入处理', () => {
    it('空 comics 数组直接返回不发 IPC', async () => {
      const { callCount } = mockFetchCoverDeferred()
      const p = prefetchCovers([], { signal: new AbortController().signal, sfwMode: false })
      vi.advanceTimersByTime(0)
      await vi.runAllTimersAsync()
      await p
      expect(callCount()).toBe(0)
    })

    it('coverUrl 为空的 comic 被过滤', async () => {
      const { deferred, callCount } = mockFetchCoverDeferred()
      const comics = [makeComic(''), makeComic('https://a.com/2.jpg')]

      const p = prefetchCovers(comics, { signal: new AbortController().signal, sfwMode: false })
      vi.advanceTimersByTime(0)
      await vi.runAllTimersAsync()
      expect(callCount()).toBe(1)
      deferred(0).resolve({ urlHash: 'h2' })
      await p
    })

    it('重复 coverUrl 去重，只发一次 IPC', async () => {
      const { spy, deferred } = mockFetchCoverDeferred()
      const comics = [
        makeComic('https://a.com/dup.jpg'),
        makeComic('https://a.com/dup.jpg'),
        makeComic('https://a.com/dup.jpg'),
      ]

      const p = prefetchCovers(comics, { signal: new AbortController().signal, sfwMode: false })
      vi.advanceTimersByTime(0)
      await vi.runAllTimersAsync()
      deferred(0).resolve({ urlHash: 'dup-hash' })
      await p
      expect(spy).toHaveBeenCalledTimes(1)
    })
  })
})
