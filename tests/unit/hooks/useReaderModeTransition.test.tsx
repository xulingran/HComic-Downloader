import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, useState, type ReactNode } from 'react'
import { DURATION } from '@/lib/anim'
import { useReaderModeTransition } from '@/hooks/useReaderModeTransition'

afterEach(() => {
  vi.useRealTimers()
})

function useHarness(initialMode: 'scroll' | 'single' | 'double' = 'scroll', initialPage = 6, reduceMotion = false) {
  const [displayMode, setDisplayMode] = useState(initialMode)
  const [currentPage, setCurrentPage] = useState(initialPage)
  const [blankPosition, setBlankPosition] = useState<'none' | 'front' | 'end'>('none')
  const transition = useReaderModeTransition({
    displayMode,
    setDisplayMode,
    currentPage,
    setCurrentPage,
    totalPages: 10,
    blankPosition,
    setBlankPosition,
    prepareTarget: () => true,
    reduceMotionOverride: reduceMotion,
  })
  return { displayMode, currentPage, blankPosition, setCurrentPage, ...transition }
}

describe('useReaderModeTransition', () => {
  it('finishes scroll and paged transitions after the StrictMode effect lifecycle probe', () => {
    vi.useFakeTimers()
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>
    const { result } = renderHook(() => useHarness(), { wrapper })

    act(() => result.current.requestDisplayMode('single'))
    act(() => vi.advanceTimersByTime(DURATION.fast * 1000))
    act(() => vi.advanceTimersByTime(0))
    act(() => vi.advanceTimersByTime(DURATION.slow * 1000))
    expect(result.current).toMatchObject({ visibleMode: 'single', phase: 'idle', isModeTransitioning: false })

    act(() => result.current.requestDisplayMode('double'))
    act(() => vi.advanceTimersByTime(DURATION.slow * 1000))
    expect(result.current).toMatchObject({ visibleMode: 'double', phase: 'idle', isModeTransitioning: false })
  })

  it('runs scroll to paged as exit, prepare, and enter before becoming idle', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useHarness())

    act(() => result.current.requestDisplayMode('single'))
    expect(result.current).toMatchObject({ targetMode: 'single', visibleMode: 'scroll', phase: 'exiting' })

    act(() => vi.advanceTimersByTime(DURATION.fast * 1000))
    expect(result.current).toMatchObject({ visibleMode: 'single', displayMode: 'single', currentPage: 6, phase: 'preparing' })

    act(() => vi.advanceTimersByTime(0))
    expect(result.current.phase).toBe('entering')
    act(() => vi.advanceTimersByTime(DURATION.slow * 1000))
    expect(result.current.phase).toBe('idle')
  })

  it('uses latest intent when targets change during exit', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useHarness())

    act(() => {
      result.current.requestDisplayMode('single')
      result.current.requestDisplayMode('double')
    })
    act(() => vi.advanceTimersByTime(DURATION.fast * 1000))

    expect(result.current).toMatchObject({ targetMode: 'double', visibleMode: 'double', displayMode: 'double' })
    expect(result.current.currentPage).toBe(5)
  })

  it('does not animate or remap when the selected mode is already stable', () => {
    const { result } = renderHook(() => useHarness('single', 4))
    act(() => result.current.requestDisplayMode('single'))
    expect(result.current).toMatchObject({ phase: 'idle', currentPage: 4, modeRevision: 0 })
  })

  it('finishes paged reflow within the reduced-motion duration', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useHarness('single', 6, true))

    act(() => result.current.requestDisplayMode('double'))
    expect(result.current).toMatchObject({ displayMode: 'double', currentPage: 5, phase: 'entering' })
    act(() => vi.advanceTimersByTime(DURATION.fast * 1000))
    expect(result.current.phase).toBe('idle')
  })

  it('cleans pending work on unmount', () => {
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() => useHarness())
    act(() => result.current.requestDisplayMode('single'))
    unmount()
    expect(() => vi.runAllTimers()).not.toThrow()
  })

  it('commits the latest currentPage when the page changes during the exit window (Bug D)', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useHarness('scroll', 6))

    act(() => result.current.requestDisplayMode('single'))
    expect(result.current.phase).toBe('exiting')

    // While still in the exit window, the user (or a stray observer) moves the
    // page. The eventual prepare commit must anchor on the latest page, not the
    // stale one captured at request time.
    act(() => result.current.setCurrentPage(3))
    act(() => vi.advanceTimersByTime(DURATION.fast * 1000))

    expect(result.current).toMatchObject({ visibleMode: 'single', phase: 'preparing' })
    expect(result.current.currentPage).toBe(3)
  })

  it('keeps a paged-to-paged reflow on the latest page when it changes before commit', () => {
    // Paged→paged commits synchronously at request time, so this guards the
    // opposite contract: when the request happens, the current page is honored.
    const { result } = renderHook(() => useHarness('single', 6))
    act(() => result.current.requestDisplayMode('double'))
    // single page 6 entering double → targetPage must include page 6.
    expect(result.current.currentPage).toBe(5)
    expect(result.current.blankPosition).toBe('none')
  })
})
