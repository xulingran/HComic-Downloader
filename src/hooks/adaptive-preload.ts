// 自适应预加载的三个核心单元。详见 docs/superpowers/specs/2026-06-16-adaptive-preload-design.md

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
