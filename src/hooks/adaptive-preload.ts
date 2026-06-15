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
