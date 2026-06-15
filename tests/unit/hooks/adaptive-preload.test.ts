import { describe, it, expect } from 'vitest'
import { computeAdaptiveParams, buildPreloadQueue, FAST_MS, SLOW_MS } from '@/hooks/adaptive-preload'

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

describe('buildPreloadQueue', () => {
  it('sequential order when alternation is false', () => {
    expect(buildPreloadQueue(10, 4, 2, 20, new Set(), false)).toEqual(
      [11, 12, 13, 14, 9, 8],
    )
  })

  it('alternation interleaves near and far pages, first is target+1', () => {
    const seq = buildPreloadQueue(10, 4, 0, 20, new Set(), true)
    // 算法定义：nearCursor 1→，farCursor ceil(4/2)=2→，交替取，超出 forward 停
    // 第一个必为近页 target+1
    expect(seq[0]).toBe(11)
    // 无重复
    expect(new Set(seq).size).toBe(seq.length)
    // 全部在 [11, 14] 内
    expect(seq.every((p) => p >= 11 && p <= 14)).toBe(true)
  })

  it('alternation with forward=12 produces interleaved sequence', () => {
    const seq = buildPreloadQueue(50, 12, 0, 100, new Set(), true)
    // 第一个必为近页 target+1，第二个为远页
    expect(seq[0]).toBe(51)
    expect(seq[1]).toBe(56) // farCursor 起点 = ceil(12/2) = 6
    // 不含重复
    expect(new Set(seq).size).toBe(seq.length)
    // 全部在 [51, 62] 内
    expect(seq.every((p) => p >= 51 && p <= 62)).toBe(true)
  })

  it('skips already-cached pages (0-based indices)', () => {
    // cached 用 0-based：索引 11 = 第 12 页 = target+2
    const cached = new Set([11]) // 跳过 page 12
    expect(buildPreloadQueue(10, 4, 0, 20, cached, false)).toEqual([11, 13, 14])
  })

  it('clamps out-of-range pages', () => {
    // target=18, total=20, forward=4 → 19,20 (21,22 越界裁剪)
    expect(buildPreloadQueue(18, 4, 2, 20, new Set(), false)).toEqual([19, 20, 17, 16])
  })

  it('returns backward-only when forward is 0', () => {
    expect(buildPreloadQueue(10, 0, 2, 20, new Set(), false)).toEqual([9, 8])
    expect(buildPreloadQueue(10, 0, 0, 20, new Set(), false)).toEqual([])
  })

  it('returns empty when all forward targets cached', () => {
    const cached = new Set([10, 11, 12, 13]) // pages 11-14 全缓存
    expect(buildPreloadQueue(10, 4, 0, 20, cached, false)).toEqual([])
  })
})
