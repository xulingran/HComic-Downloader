/**
 * 共享动画 API。
 *
 * 本文件是整个动画工程（变更 1-6）的单一来源：
 *   - DURATION 常量与 tailwind.config.js 的 transitionDuration 令牌同值，
 *     供 JS 内联 style 或 framer-motion transition 使用
 *   - variants 集中定义进入/退出动画，内置 reduced-motion 退化路径，
 *     各组件无需重复判断 useReducedMotion
 *   - useReducedMotionPreference 是对 framer-motion useReducedMotion 的薄封装，
 *     便于测试 mock
 *
 * 本变更（animation-foundation）只定义，不消费。
 * 后续变更（consistency/reader/list/skeleton）按需导入。
 */
import { useReducedMotion as fmUseReducedMotion, type Variants, type Transition, type Variant } from 'framer-motion'

/** 动画时长常量（与 tailwind.config.js transitionDuration 令牌同值）。 */
export const DURATION = {
  fast: 0.15,
  base: 0.2,
  slow: 0.3,
  slower: 0.45,
} as const

/** 标准弹簧过渡：用于弹窗进出场、需要"弹一下"质感。 */
export const springTransition: Transition = {
  type: 'spring',
  stiffness: 300,
  damping: 26,
  mass: 0.8,
}

/** 平滑过渡：用于位置过渡、平移类动画（无 overshoot）。 */
export const smoothTransition: Transition = {
  type: 'tween',
  ease: [0.4, 0, 0.2, 1],
  duration: DURATION.slow,
}

/** 标准过渡：默认 ease-out，用于通用微交互。 */
export const standardTransition: Transition = {
  type: 'tween',
  ease: 'easeOut',
  duration: DURATION.base,
}

/**
 * 进入/退出 variants 的工厂。
 *
 * 在 reduced-motion 开启时退化为纯 opacity 过渡（无位移、无缩放），
 * 这是比全局 CSS 兜底更细腻的退化路径——后者会把所有动画压成瞬时，
 * 而这里保留一个短暂的淡入淡出，体验不至于过于生硬。
 */
export function createPresenceVariants(opts: {
  enter?: Variant
  exit?: Variant
  reduced?: 'opacity-only'
}): Variants {
  const reduced = opts.reduced ?? 'opacity-only'
  const enterVariant = opts.enter ?? {}
  const exitVariant = opts.exit ?? {}
  return {
    initial: reduced === 'opacity-only' ? { opacity: 0 } : enterVariant,
    animate: { opacity: 1, ...enterVariant },
    exit: reduced === 'opacity-only' ? { opacity: 0 } : exitVariant,
  }
}

/**
 * 对 framer-motion useReducedMotion 的薄封装。
 * 测试可通过 mock 此函数控制 reduced-motion 行为。
 */
export function useReducedMotionPreference(): boolean {
  return fmUseReducedMotion() ?? false
}
