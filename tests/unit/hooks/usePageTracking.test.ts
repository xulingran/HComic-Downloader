import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePageTracking } from '@/hooks/usePageTracking'

// Records every IntersectionObserver construction so tests can assert that the
// observer is rebuilt (with the right root) when the visible mode changes.
const constructions: Array<{ root: Element | null; threshold: number }> = []
const instances: RecordingIntersectionObserver[] = []
let observeCount = 0

class RecordingIntersectionObserver {
  readonly root: Element | null
  readonly rootMargin: string = ''
  readonly thresholds: ReadonlyArray<number> = []
  private readonly callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback
    this.root = options?.root ?? null
    const t = options?.threshold
    this.thresholds = Array.isArray(t) ? t : (typeof t === 'number' ? [t] : [])
    constructions.push({ root: this.root, threshold: this.thresholds[0] ?? 0 })
    instances.push(this)
  }
  observe() { observeCount += 1 }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return [] }
  // helper to invoke the callback in tests
  fire(entries: IntersectionObserverEntry[]) { this.callback(entries, this as unknown as IntersectionObserver) }
}

beforeEach(() => {
  constructions.length = 0
  instances.length = 0
  observeCount = 0
  globalThis.IntersectionObserver = RecordingIntersectionObserver as unknown as typeof IntersectionObserver
})
afterEach(() => {
  vi.restoreAllMocks()
})

function makeRefs() {
  const pageRefs = { current: [document.createElement('div')] }
  const scrollContainerRef = { current: document.createElement('div') }
  return { pageRefs, scrollContainerRef }
}

describe('usePageTracking', () => {
  it('rebuilds the observer with the scroll container as root when entering scroll mode (Bug A)', () => {
    const { pageRefs, scrollContainerRef } = makeRefs()
    const setCurrentPage = vi.fn()

    const { rerender } = renderHook(
      ({ visibleMode }: { visibleMode: 'scroll' | 'single' }) =>
        usePageTracking(
          pageRefs,
          scrollContainerRef,
          false,
          1,
          setCurrentPage,
          'loaded',
          1,
          visibleMode,
        ),
      { initialProps: { visibleMode: 'single' as const } },
    )

    // While in paged mode the observer is created once.
    expect(constructions).toHaveLength(1)
    // Paged mode: scroll container is not the active root at first build (it
    // exists in this synthetic harness, but the point is the count is stable).
    const pagedObserveCount = observeCount
    expect(pagedObserveCount).toBeGreaterThan(0)

    // Switch into scroll mode: the hook must rebuild the observer.
    rerender({ visibleMode: 'scroll' })
    expect(constructions).toHaveLength(2)
    // The rebuilt observer must bind to the scroll container as root.
    expect(constructions[1]!.root).toBe(scrollContainerRef.current)
    // And re-observe every page ref.
    expect(observeCount).toBeGreaterThan(pagedObserveCount)
  })

  it('does not rebuild the observer when only currentPage changes', () => {
    const { pageRefs, scrollContainerRef } = makeRefs()
    const setCurrentPage = vi.fn()

    const { rerender } = renderHook(
      ({ currentPage }: { currentPage: number }) =>
        usePageTracking(
          pageRefs,
          scrollContainerRef,
          false,
          currentPage,
          setCurrentPage,
          'loaded',
          1,
          'scroll',
        ),
      { initialProps: { currentPage: 1 } },
    )

    expect(constructions).toHaveLength(1)
    rerender({ currentPage: 5 })
    rerender({ currentPage: 9 })
    // currentPage churn alone must not churn the observer.
    expect(constructions).toHaveLength(1)
  })

  it('ignores observer notifications while frozen (mode transition gate)', () => {
    const { pageRefs, scrollContainerRef } = makeRefs()
    const setCurrentPage = vi.fn()

    renderHook(() =>
      usePageTracking(
        pageRefs,
        scrollContainerRef,
        false,
        1,
        setCurrentPage,
        'loaded',
        1,
        'scroll',
        // freezeRef
        { current: false } as React.RefObject<boolean>,
        // frozen (mode transitioning)
        true,
      ),
    )

    // Build a fake intersecting entry pointing at the tracked page element and
    // deliver it through the most recently constructed observer.
    const target = pageRefs.current[0]!
    const activeObserver = instances[instances.length - 1]!
    activeObserver.fire([
      { isIntersecting: true, target, boundingClientRect: { top: 0 } } as unknown as IntersectionObserverEntry,
    ])
    expect(setCurrentPage).not.toHaveBeenCalled()
  })

  it('creates no observer before pages are loaded', () => {
    const { pageRefs, scrollContainerRef } = makeRefs()
    const setCurrentPage = vi.fn()
    renderHook(() =>
      usePageTracking(pageRefs, scrollContainerRef, false, 0, setCurrentPage, 'loading', 0, 'scroll'),
    )
    expect(constructions).toHaveLength(0)
  })
})
