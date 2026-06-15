import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useFlipPace, STALE_MS } from '@/hooks/adaptive-preload'

describe('useFlipPace', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-16T00:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null interval before enough samples', () => {
    const { result, rerender } = renderHook(({ target }) => useFlipPace(target), {
      initialProps: { target: 1 },
    })
    // 前进到 2（1 个间隔，< MIN_SAMPLES=3）
    act(() => { vi.advanceTimersByTime(500); rerender({ target: 2 }) })
    expect(result.current.effectiveInterval).toBeNull()
    expect(result.current.isFlippingFast).toBe(false)
  })

  it('computes median interval after enough forward flips', () => {
    const { result, rerender } = renderHook(({ target }) => useFlipPace(target), {
      initialProps: { target: 1 },
    })
    // 翻到 target 5 产生 4 个时间戳 → 3 个间隔（满足 MIN_SAMPLES=3）
    act(() => { vi.advanceTimersByTime(500); rerender({ target: 2 }) })
    act(() => { vi.advanceTimersByTime(500); rerender({ target: 3 }) })
    act(() => { vi.advanceTimersByTime(500); rerender({ target: 4 }) })
    act(() => { vi.advanceTimersByTime(500); rerender({ target: 5 }) })
    expect(result.current.effectiveInterval).toBe(500)
    expect(result.current.isFlippingFast).toBe(true)
  })

  it('ignores backward flips (page decreasing)', () => {
    const { result, rerender } = renderHook(({ target }) => useFlipPace(target), {
      initialProps: { target: 5 },
    })
    act(() => { vi.advanceTimersByTime(300); rerender({ target: 4 }) }) // 后退，不记录
    act(() => { vi.advanceTimersByTime(300); rerender({ target: 3 }) }) // 后退，不记录
    expect(result.current.effectiveInterval).toBeNull()
  })

  it('isFlippingFast becomes false after going stale', () => {
    const { result, rerender } = renderHook(({ target }) => useFlipPace(target), {
      initialProps: { target: 1 },
    })
    act(() => { vi.advanceTimersByTime(400); rerender({ target: 2 }) })
    act(() => { vi.advanceTimersByTime(400); rerender({ target: 3 }) })
    act(() => { vi.advanceTimersByTime(400); rerender({ target: 4 }) })
    act(() => { vi.advanceTimersByTime(400); rerender({ target: 5 }) })
    expect(result.current.isFlippingFast).toBe(true)
    // 停留超过 STALE_MS，触发回落定时器（1s 节流，需 advance 过去）
    act(() => { vi.advanceTimersByTime(STALE_MS + 1100) })
    expect(result.current.isFlippingFast).toBe(false)
  })

  it('reset clears samples', () => {
    const { result, rerender } = renderHook(({ target }) => useFlipPace(target), {
      initialProps: { target: 1 },
    })
    act(() => { vi.advanceTimersByTime(400); rerender({ target: 2 }) })
    act(() => { vi.advanceTimersByTime(400); rerender({ target: 3 }) })
    act(() => { vi.advanceTimersByTime(400); rerender({ target: 4 }) })
    act(() => { vi.advanceTimersByTime(400); rerender({ target: 5 }) })
    expect(result.current.effectiveInterval).toBe(400)
    act(() => { result.current.reset() })
    expect(result.current.effectiveInterval).toBeNull()
  })
})
