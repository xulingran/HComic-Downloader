import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { scheduleIdle } from '@/lib/scheduler'

describe('scheduleIdle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('在 idle 回调中执行任务（jsdom mock 走 setTimeout）', () => {
    const task = vi.fn()
    scheduleIdle(task)
    expect(task).not.toHaveBeenCalled()
    // jsdom polyfill 用 setTimeout(_, 0)，需推进定时器
    vi.advanceTimersByTime(0)
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('cancel 撤销尚未触发的调度', () => {
    const task = vi.fn()
    const handle = scheduleIdle(task)
    handle.cancel()
    vi.advanceTimersByTime(100)
    expect(task).not.toHaveBeenCalled()
  })

  it('cancel 多次调用为空操作，不抛错', () => {
    const task = vi.fn()
    const handle = scheduleIdle(task)
    handle.cancel()
    handle.cancel()
    vi.advanceTimersByTime(100)
    expect(task).not.toHaveBeenCalled()
  })

  it('已触发的调度再 cancel 为空操作', () => {
    const task = vi.fn()
    const handle = scheduleIdle(task)
    vi.advanceTimersByTime(0)
    expect(task).toHaveBeenCalledTimes(1)
    // 已执行后再 cancel 不应抛错
    expect(() => handle.cancel()).not.toThrow()
  })

  describe('降级路径：移除原生 requestIdleCallback 后走 setTimeout', () => {
    beforeEach(() => {
      // 临时移除 window 上的实现，强制走降级分支
      vi.stubGlobal('window', {
        ...window,
        requestIdleCallback: undefined,
        cancelIdleCallback: undefined,
        setTimeout: window.setTimeout.bind(window),
        clearTimeout: window.clearTimeout.bind(window),
      })
    })
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('无 requestIdleCallback 时降级为 setTimeout(_, 0)', () => {
      const task = vi.fn()
      scheduleIdle(task)
      expect(task).not.toHaveBeenCalled()
      vi.advanceTimersByTime(0)
      expect(task).toHaveBeenCalledTimes(1)
    })

    it('降级路径的 cancel 生效', () => {
      const task = vi.fn()
      const handle = scheduleIdle(task)
      handle.cancel()
      vi.advanceTimersByTime(100)
      expect(task).not.toHaveBeenCalled()
    })
  })
})
