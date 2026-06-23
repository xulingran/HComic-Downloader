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
 * 进入/退出 variants 的工厂（通用）。
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

// ─────────────────────────────────────────────────────────────────────────────
// 容器级弹窗 variants（变更 2 引入）
//
// 设计原则：统一曲线（spring）与时长（slow=300ms），但保留各自运动方向——
// Modal 用 scale（居中）、Drawer 从右滑（右侧定位）、Reader 从下滑（占满）、
// Toast 从上方滑（顶部定位）。方向有语义意义，不强求统一。
// ─────────────────────────────────────────────────────────────────────────────

/** Modal 内层：scale + opacity（居中弹窗）。 */
export const modalPresenceVariants: Variants = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1, transition: springTransition },
  exit: { opacity: 0, scale: 0.95, transition: springTransition },
}

/** 遮罩层：纯 opacity（所有弹窗共用）。 */
export const overlayPresenceVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
}

/** ComicInfoDrawer：从右滑入。 */
export const drawerPresenceVariants: Variants = {
  initial: { x: '100%' },
  animate: { x: 0, transition: springTransition },
  exit: { x: '100%', transition: springTransition },
}

/** ComicReaderModal：从下滑入（保留现有方向）。 */
export const readerPresenceVariants: Variants = {
  initial: { y: '100%' },
  animate: { y: 0, transition: springTransition },
  exit: { y: '100%', transition: springTransition },
}

/** Toast：从上方滑入（y 用 rem 单位保持与原 -1rem 一致）。 */
export const toastPresenceVariants: Variants = {
  initial: { y: '-1rem', opacity: 0 },
  animate: { y: 0, opacity: 1, transition: springTransition },
  exit: { y: '-1rem', opacity: 0, transition: springTransition },
}

/**
 * reduced-motion 包装器：把 variant 的运动分量（x/y/scale）置零，只保留 opacity。
 * 在 reduced-motion 开启时调用，让弹窗退化为纯淡入淡出，无画面位移。
 */
export function reduceSafe(variant: Variants): Variants {
  return {
    initial: stripMotion(variant.initial),
    animate: stripMotion(variant.animate),
    exit: stripMotion(variant.exit),
  }
}

function stripMotion(target: Variant | undefined): Variant {
  if (!target || typeof target !== 'object') return { opacity: 0 }
  const { x, y, scale, ...rest } = target as Record<string, unknown>
  void x; void y; void scale
  return rest as Variant
}

// ─────────────────────────────────────────────────────────────────────────────
// ComicInfoDrawer tag 列表 stagger（变更 2 引入）
//
// 约束：tag 数量可能很多（几十个），全量 stagger 会让总时长过长。
// 组件侧通过 STAGGER_LIMIT（40）实现封顶——仅前 40 个用 motion.button 参与 stagger，
// 第 41 个及之后用普通 button 立即出现。本处只定义 variants，切片逻辑在组件。
// ─────────────────────────────────────────────────────────────────────────────

/** tag 列表容器：错峰子项，20ms 间隔，起始延迟 100ms。 */
export const tagListVariants: Variants = {
  hidden: { transition: { staggerChildren: 0.02, delayChildren: 0.1 } },
  show: { transition: { staggerChildren: 0.02, delayChildren: 0.1 } },
}

/** tag 子项：淡入 + 轻微上移。 */
export const tagItemVariants: Variants = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0, transition: { duration: DURATION.fast } },
}

// ─────────────────────────────────────────────────────────────────────────────
// 阅读器翻页 variants（变更 3 引入）
//
// 设计要点：翻页用 smooth 曲线（cubic-bezier(0.4,0,0.2,1)）而非 spring。
// spring 的 overshoot 会让页面"弹过"再回弹，翻页场景不合适——用户期望页面
// 稳稳停下。smooth 有"减速停下"的感觉，符合翻页直觉。
// ─────────────────────────────────────────────────────────────────────────────

/** 翻页过渡时长（smooth 曲线）。 */
export const PAGE_FLIP_DURATION = 0.25

/** 翻页过渡配置：smooth tween。 */
export const pageFlipTransition: Transition = {
  type: 'tween',
  ease: [0.4, 0, 0.2, 1],
  duration: PAGE_FLIP_DURATION,
}

/**
 * 方向感知的翻页 variants。
 * enter/exit 是函数形式，framer-motion 通过 AnimatePresence 的 custom prop
 * 自动注入 direction。forward 时新页从右进、旧页向左出；backward 反之。
 */
export function getDirectionalPageVariants(): Variants {
  return {
    enter: (dir: 'forward' | 'backward') => ({
      x: dir === 'forward' ? '100%' : '-100%',
      opacity: 1,
    }),
    center: { x: 0, opacity: 1 },
    exit: (dir: 'forward' | 'backward') => ({
      x: dir === 'forward' ? '-100%' : '100%',
      opacity: 1,
    }),
  }
}

/**
 * reduced-motion 翻页 variants：退化为纯 opacity crossfade，无位移。
 * 时长压到 150ms（DURATION.fast）。
 */
export function getReducedPageVariants(): Variants {
  return {
    enter: { opacity: 0 },
    center: { opacity: 1, transition: { duration: DURATION.fast } },
    exit: { opacity: 0, transition: { duration: DURATION.fast } },
  }
}

/**
 * 统一获取翻页 variants：根据 reduced-motion 决策。
 * direction 由 framer-motion 通过 AnimatePresence 的 custom prop 自动注入给
 * 函数形式的 variants，无需在此处传入。
 */
export function usePageFlipVariants(): Variants {
  const reduceMotion = useReducedMotionPreference()
  return reduceMotion ? getReducedPageVariants() : getDirectionalPageVariants()
}

void pageFlipTransition // 预留给组件按需引用，避免 tree-shake 误删

// ─────────────────────────────────────────────────────────────────────────────
// 列表进出场 variants（变更 4 引入）
//
// 约束：搜索结果可能上百项，全量 stagger 会让总时长过长且卡顿。
// 通过 getCardItemVariants(index) 实现 stagger 封顶——前 STAGGER_LIMIT 项错峰，
// 之后立即出现。STAGGER_LIMIT 与 ComicInfoDrawer tag stagger 保持一致（20）。
// ─────────────────────────────────────────────────────────────────────────────

/** stagger 封顶阈值：仅前 STAGGER_LIMIT 项错峰，之后立即出现。 */
export const STAGGER_LIMIT = 20

/** 单项 stagger 间隔（秒）。 */
const CARD_STAGGER_STEP = 0.02

/** ComicCard 网格子项基础 variant（无 delay）。 */
export const cardItemVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, scale: 0.9 },
}

/**
 * 带 stagger delay 的卡片 variant。
 * index < STAGGER_LIMIT 时返回带 delay 的 variant；之后 delay=0。
 */
export function getCardItemVariants(index: number): Variants {
  if (index >= STAGGER_LIMIT) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
    }
  }
  const delay = index * CARD_STAGGER_STEP
  return {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0, transition: { delay } },
    exit: { opacity: 0, scale: 0.9 },
  }
}

/** reduced-motion 卡片 variant：纯 opacity，无位移无缩放。 */
export function getReducedCardItemVariants(): Variants {
  return {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  }
}

/** DownloadPage 任务项 variant：从顶部滑入。 */
export const taskItemVariants: Variants = {
  initial: { opacity: 0, y: -8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, scale: 0.9 },
}

/** reduced-motion 任务项 variant。 */
export function getReducedTaskItemVariants(): Variants {
  return {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 页面切换 variants（变更 tab-switch-animation 引入）
//
// 设计要点：方向感知的 slide + fade，位移幅度 8%（克制，非全页翻转），
// 使用 smooth 曲线（cubic-bezier(0.4,0,0.2,1)），时长 300ms（DURATION.slow）。
// mode="sync" 下 exit/enter 同时播放形成推送效果，300ms 保持干脆无等待感。
// 方向由 AnimatePresence 的 custom prop 注入，索引差决定左/右。
// ─────────────────────────────────────────────────────────────────────────────

/** TAB_ORDER 常量：与 Sidebar 菜单顺序一致，作为方向计算的单一来源。 */
export const TAB_ORDER = [
  'search',
  'downloads',
  'favourites',
  'history',
  'toolbox',
  'maintenance',
  'settings',
  'about',
] as const

/** 方向感知的 tab 页面切换 variants。
 *
 * 使用 sync 模式（AnimatePresence 默认）：exit 和 enter 同时播放，
 * 旧页滑出的同时新页滑入，形成连续"推送"效果。
 * exit 与 enter 同速对称，时长 DURATION.slow 保持干脆。
 */
export function getTabPageVariants(): Variants {
  return {
    initial: (dir: number) => ({
      x: dir > 0 ? '8%' : dir < 0 ? '-8%' : 0,
      opacity: 0,
    }),
    animate: {
      x: 0,
      opacity: 1,
      transition: smoothTransition,
    },
    exit: (dir: number) => ({
      x: dir > 0 ? '-8%' : dir < 0 ? '8%' : 0,
      opacity: 0,
      transition: smoothTransition,
    }),
  }
}

/** reduced-motion tab 页面 variants：纯 opacity crossfade，无位移。 */
export function getReducedTabPageVariants(): Variants {
  return {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: DURATION.fast } },
    exit: { opacity: 0, transition: { duration: DURATION.fast } },
  }
}

/**
 * 统一获取 tab 页面 variants：根据 reduced-motion 偏好自动选择。
 * direction 由 AnimatePresence 的 custom prop 自动注入到函数形式的 variants。
 */
export function useTabPageVariants(): Variants {
  const reduceMotion = useReducedMotionPreference()
  return reduceMotion ? getReducedTabPageVariants() : getTabPageVariants()
}


