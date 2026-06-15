import { describe, it, expect } from 'vitest'
import { computeAdaptiveParams, FAST_MS, SLOW_MS } from '@/hooks/adaptive-preload'

describe('computeAdaptiveParams', () => {
  const base = { forward: 8, concurrency: 3 }

  it('returns baseline when interval is null (no samples)', () => {
    expect(computeAdaptiveParams(null, base)).toEqual({
      forward: 8, concurrency: 3, alternation: false,
    })
  })

  it('returns baseline when interval >= SLOW_MS', () => {
    expect(computeAdaptiveParams(SLOW_MS, base)).toEqual({
      forward: 8, concurrency: 3, alternation: false,
    })
    expect(computeAdaptiveParams(5000, base)).toEqual({
      forward: 8, concurrency: 3, alternation: false,
    })
  })

  it('returns upper-bound + alternation when interval <= FAST_MS', () => {
    // forward = min(8 * 2.5, 30) = 20; concurrency = min(3 + 2, 6) = 5
    expect(computeAdaptiveParams(FAST_MS, base)).toEqual({
      forward: 20, concurrency: 5, alternation: true,
    })
    expect(computeAdaptiveParams(100, base)).toEqual({
      forward: 20, concurrency: 5, alternation: true,
    })
  })

  it('linearly interpolates at midpoint', () => {
    // midpoint = (700 + 2000) / 2 = 1350
    // ratio = 0.5; forward = round(8 + (20-8)*0.5) = 14; concurrency = round(3 + (5-3)*0.5) = 4
    expect(computeAdaptiveParams(1350, base)).toEqual({
      forward: 14, concurrency: 4, alternation: false,
    })
  })

  it('clamps forward to 30 when base*2.5 exceeds it', () => {
    const bigBase = { forward: 20, concurrency: 3 }
    // min(20*2.5, 30) = 30
    expect(computeAdaptiveParams(FAST_MS, bigBase).forward).toBe(30)
  })

  it('clamps concurrency to 6 when base+2 exceeds it', () => {
    const bigBase = { forward: 8, concurrency: 5 }
    // min(5+2, 6) = 6
    expect(computeAdaptiveParams(FAST_MS, bigBase).concurrency).toBe(6)
  })

  it('respects base.forward = 0 (preload disabled)', () => {
    expect(computeAdaptiveParams(FAST_MS, { forward: 0, concurrency: 3 })).toEqual({
      forward: 0, concurrency: 5, alternation: true,
    })
  })
})
