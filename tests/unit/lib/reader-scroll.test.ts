import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareScrollAnchor } from '@/lib/reader-scroll'

// jsdom lacks ResizeObserver; install a minimal mock that lets tests drive
// callbacks synchronously so the settle/re-scroll logic is observable.
type ROCallback = (entries: ResizeObserverEntry[]) => void
class MockResizeObserver {
  static last: MockResizeObserver | null = null
  private callback: ROCallback
  private targets: Element[] = []
  constructor(callback: ROCallback) {
    this.callback = callback
    MockResizeObserver.last = this
  }
  observe(target: Element) { this.targets.push(target) }
  unobserve() {}
  disconnect() { this.targets = [] }
  fire(entries: ResizeObserverEntry[]) { this.callback(entries) }
}

beforeEach(() => {
  MockResizeObserver.last = null
  ;(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
    MockResizeObserver as unknown as typeof ResizeObserver
})
afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver
})

describe('prepareScrollAnchor', () => {
  it('scrolls the anchor element into view immediately and reports ready', () => {
    const scrollIntoView = vi.fn()
    const element = { offsetHeight: 100, offsetWidth: 50, scrollIntoView } as unknown as HTMLElement
    vi.useFakeTimers()
    const controller = prepareScrollAnchor(() => element, 6)
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ behavior: 'instant', block: 'start' })
    controller.clear()
  })

  it('re-scrolls when the anchor size changes (image inflation) and stops once stable', () => {
    const scrollIntoView = vi.fn()
    let height = 100
    const element = {
      get offsetHeight() { return height },
      offsetWidth: 50,
      scrollIntoView,
    } as unknown as HTMLElement
    vi.useFakeTimers()
    prepareScrollAnchor(() => element, 3)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    // First resize: height grows → re-scroll fires
    height = 240
    MockResizeObserver.last!.fire([{ target: element as Element } as ResizeObserverEntry])
    expect(scrollIntoView).toHaveBeenCalledTimes(2)

    // Subsequent stable samples (same height/width) must NOT re-scroll, and the
    // observer self-detaches after MAX_SETTLE_FRAMES stable samples.
    for (let i = 0; i < 8; i++) {
      MockResizeObserver.last!.fire([{ target: element as Element } as ResizeObserverEntry])
    }
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it('stops re-scrolling after the settle budget even if resize keeps firing', () => {
    const scrollIntoView = vi.fn()
    let height = 100
    const element = {
      get offsetHeight() { return height },
      offsetWidth: 50,
      scrollIntoView,
    } as unknown as HTMLElement
    vi.useFakeTimers()
    prepareScrollAnchor(() => element, 2)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    // Keep inflating; the hard settle budget (RESIZE_SETTLE_MS) must stop it.
    for (let i = 0; i < 20; i++) {
      height += 50
      MockResizeObserver.last!.fire([{ target: element as Element } as ResizeObserverEntry])
    }
    const callsBeforeBudget = scrollIntoView.mock.calls.length
    vi.advanceTimersByTime(500)
    height += 50
    MockResizeObserver.last?.fire([{ target: element as Element } as ResizeObserverEntry])
    expect(scrollIntoView.mock.calls.length).toBe(callsBeforeBudget) // no further re-scrolls
  })

  it('returns a ready controller without observing when the anchor element is missing', () => {
    const controller = prepareScrollAnchor(() => null, 5)
    expect(MockResizeObserver.last).toBeNull()
    expect(() => controller.clear()).not.toThrow()
  })

  it('returns a no-op controller for non-positive anchor pages', () => {
    const controller = prepareScrollAnchor(() => null, 0)
    expect(() => controller.clear()).not.toThrow()
  })
})
