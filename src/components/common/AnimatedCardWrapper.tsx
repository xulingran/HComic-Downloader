import { motion } from 'framer-motion'
import { getCardItemVariants, getReducedCardItemVariants, useReducedMotionPreference } from '../../lib/anim'

interface AnimatedCardWrapperProps {
  /** 卡片在列表中的位置索引，用于计算 stagger delay（仅前 20 项错峰） */
  index: number
  /** 稳定 key，由调用方传入（通常是 getComicKey(comic)） */
  children: React.ReactNode
}

/**
 * ComicCard / BlockedPlaceholder 的动画包装组件。
 *
 * 提供：
 *   - layout 动画：卡片位置变化（cardStyle 切换、列表重排）时平滑过渡
 *   - 进出场动画：opacity + y（前 20 项错峰，之后立即）
 *   - reduced-motion 退化：纯 opacity，关闭 layout
 *   - CSS contain: layout：限制长列表重排范围
 *
 * 调用方需在外层用 `<LayoutGroup>` + `<AnimatePresence>` 包裹列表容器。
 */
export function AnimatedCardWrapper({ index, children }: AnimatedCardWrapperProps) {
  const reduceMotion = useReducedMotionPreference()
  const variants = reduceMotion ? getReducedCardItemVariants() : getCardItemVariants(index)

  return (
    <motion.div
      layout={!reduceMotion}
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      style={{ contain: reduceMotion ? undefined : 'layout' }}
    >
      {children}
    </motion.div>
  )
}
