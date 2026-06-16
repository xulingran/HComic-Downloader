// 自适应预加载的三个核心单元。详见 docs/superpowers/specs/2026-06-16-adaptive-preload-design.md

import { useCallback, useEffect, useRef, useState } from 'react'

/** 最大样本数（时间戳） */
export const FLIP_PACE_SAMPLE_SIZE = 6
/** 计算中位数所需的最小间隔样本数 */
export const FLIP_PACE_MIN_SAMPLES = 3
/** 无翻页超过此时长(ms)视为已停留 → 回落 */
export const STALE_MS = 2000
/** 回落检测定时器的节流间隔(ms)：低于此时长重复检测无意义 */
export const STALE_CHECK_INTERVAL_MS = 1000

/** 极快阈值(ms)：interval ≤ 此值触发远近交替队列 */
export const FAST_MS = 700
/** 慢速阈值(ms)：interval ≥ 此值回落到基线 */
export const SLOW_MS = 2000
/** forward 动态上限倍率 */
const FORWARD_BOOST = 2.5
/** forward 绝对上限（config 中 preview_preload_forward 的合法上限） */
const FORWARD_HARD_CAP = 30
/** concurrency 动态上限增量 */
const CONCURRENCY_BOOST = 2
/** concurrency 绝对上限（config 中 preview_preload_concurrency 的合法上限） */
const CONCURRENCY_HARD_CAP = 6

export interface AdaptiveParams {
  forward: number
  concurrency: number
  alternation: boolean
}

/**
 * 把平滑后的翻页间隔映射为动态预加载参数。
 * interval 为 null（无样本/stale）或 ≥ SLOW_MS 时返回基线；
 * ≤ FAST_MS 时返回上限并启用远近交替；其间线性插值。
 */
export function computeAdaptiveParams(
  interval: number | null,
  base: { forward: number; concurrency: number },
): AdaptiveParams {
  if (interval === null || interval >= SLOW_MS) {
    return { forward: base.forward, concurrency: base.concurrency, alternation: false }
  }
  const upperForward = Math.min(base.forward * FORWARD_BOOST, FORWARD_HARD_CAP)
  const upperConcurrency = Math.min(base.concurrency + CONCURRENCY_BOOST, CONCURRENCY_HARD_CAP)

  if (interval <= FAST_MS) {
    return {
      forward: Math.round(upperForward),
      concurrency: Math.round(upperConcurrency),
      alternation: true,
    }
  }
  // 线性插值：FAST_MS → 上限，SLOW_MS → 基线
  const ratio = (SLOW_MS - interval) / (SLOW_MS - FAST_MS) // ∈ (0, 1)
  return {
    forward: Math.round(base.forward + (upperForward - base.forward) * ratio),
    concurrency: Math.round(base.concurrency + (upperConcurrency - base.concurrency) * ratio),
    alternation: false,
  }
}

/**
 * 构造预加载页号队列（1-based）。
 * - alternation=false：顺序 [target+1..target+forward] 后接 [target-1..target-backward]
 * - alternation=true：远近交替，近页游标从 1、远页游标从 ceil(forward/2) 起，交替取，
 *   保证即将到达的远页在翻页追上之前落袋。
 * 全程跳过已缓存（0-based 索引集合）与越界页，返回去重后的数组。
 */
export function buildPreloadQueue(
  target: number,
  forward: number,
  backward: number,
  total: number,
  cached: Set<number>,
  alternation: boolean,
): number[] {
  const result: number[] = []
  const seen = new Set<number>()
  const pushIfValid = (page: number) => {
    if (page < 1 || page > total) return
    if (cached.has(page - 1)) return
    if (seen.has(page)) return
    seen.add(page)
    result.push(page)
  }

  if (alternation && forward > 0) {
    let nearCursor = 1
    let farCursor = Math.ceil(forward / 2)
    while (nearCursor <= forward || farCursor <= forward) {
      if (nearCursor <= forward) {
        pushIfValid(target + nearCursor)
        nearCursor++
      }
      if (farCursor <= forward) {
        pushIfValid(target + farCursor)
        farCursor++
      }
    }
  } else {
    for (let i = 1; i <= forward; i++) pushIfValid(target + i)
  }
  for (let i = 1; i <= backward; i++) pushIfValid(target - i)
  return result
}

export interface FlipPace {
  effectiveInterval: number | null
  isFlippingFast: boolean
  reset: () => void
}

/**
 * 从时间戳数组与最后一次翻页时间计算派生状态。
 * 纯函数：读入 ref 当前快照，返回 {effectiveInterval, isFlippingFast}。
 * 供 effect 调用后写入 state，避免渲染期间访问 ref（react-hooks/refs 规则）。
 */
function derivePace(
  timestamps: number[],
  lastFlipTs: number,
): Pick<FlipPace, 'effectiveInterval' | 'isFlippingFast'> {
  const diffs: number[] = []
  for (let i = 1; i < timestamps.length; i++) {
    const d = timestamps[i] - timestamps[i - 1]
    if (d > 0) diffs.push(d)
  }
  let effectiveInterval: number | null = null
  if (diffs.length >= FLIP_PACE_MIN_SAMPLES) {
    const sorted = [...diffs].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    effectiveInterval =
      sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
  }
  const stale = lastFlipTs === 0 || Date.now() - lastFlipTs > STALE_MS
  const isFlippingFast = !stale && effectiveInterval !== null && effectiveInterval <= FAST_MS
  return { effectiveInterval, isFlippingFast }
}

/**
 * 跟踪 preloadTarget 的前进翻页节奏，输出平滑后的间隔与"是否极快"判定。
 * 仅记录前进方向（页号增大）的变化；样本不足或 stale 时退回 null/false。
 * 回落通过 1s 节流定时器检测 lastFlipTs 实现——无需额外衰减逻辑。
 *
 * 派生值（effectiveInterval/isFlippingFast）在 effect 中计算后写入 state，
 * 渲染期间只读 state，不访问 ref（符合 react-hooks/refs 规则）。
 *
 * 用 Date.now() 而非 performance.now()：前者随系统时钟走，jsdom/vitest 下
 * vi.setSystemTime / vi.advanceTimersByTime 可控；performance.now() 在 jsdom
 * 不随定时器推进，会导致测试无法驱动节奏。
 */
export function useFlipPace(target: number): FlipPace {
  const timestampsRef = useRef<number[]>([])
  const lastTargetRef = useRef<number>(target)
  const lastFlipTsRef = useRef<number>(0)
  const [pace, setPace] = useState<Pick<FlipPace, 'effectiveInterval' | 'isFlippingFast'>>({
    effectiveInterval: null,
    isFlippingFast: false,
  })

  // 记录前进翻页，并在 effect 内重算派生值（避免渲染期访问 ref）
  useEffect(() => {
    if (target > lastTargetRef.current) {
      const now = Date.now()
      const ts = timestampsRef.current
      ts.push(now)
      if (ts.length > FLIP_PACE_SAMPLE_SIZE) ts.shift()
      lastFlipTsRef.current = now
      setPace(derivePace(ts, now))
    }
    lastTargetRef.current = target
  }, [target])

  // 回落检测定时器（1s 节流）：stale 后重算使 isFlippingFast 自然变 false
  useEffect(() => {
    const id = setInterval(() => {
      if (lastFlipTsRef.current > 0 && Date.now() - lastFlipTsRef.current > STALE_MS) {
        setPace(derivePace(timestampsRef.current, lastFlipTsRef.current))
      }
    }, STALE_CHECK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  const reset = useCallback(() => {
    timestampsRef.current = []
    lastFlipTsRef.current = 0
    setPace(derivePace([], 0))
  }, [])

  return { ...pace, reset }
}
