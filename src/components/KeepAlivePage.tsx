/**
 * keep-alive tab 页面容器。
 *
 * 配合 App 的 keep-alive 渲染策略：每个已访问的 tab 页面由一个本组件实例常驻，
 * 切走不卸载（display:none）、切回复用。动画采用命令式驱动（useAnimationControls），
 * 在 isActive 切换时手动 start 进/出场过渡，使每次切换（含切回已存活实例）都重播动画。
 *
 * 与 page-keep-alive 规范协调：display 切换与退出动画的时序保证退出页在退出动画
 * 期间保持可见（display:block），动画完成后才隐藏，等效 AnimatePresence mode="sync"
 * 的连续推送效果。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useAnimationControls } from 'framer-motion'
import { getTabEnterTarget, getTabExitTarget, useReducedMotionPreference, useTabPageVariants } from '@/lib/anim'

interface KeepAlivePageProps {
  /** 该页面是否为当前激活的 tab。 */
  isActive: boolean
  /** 当前导航方向（+1 向右 / -1 向左 / 0 同页或首屏），由 TAB_ORDER 索引差决定。 */
  direction: number
  /** 页面真实内容。 */
  children: ReactNode
}

export function KeepAlivePage({ isActive, direction, children }: KeepAlivePageProps) {
  const controls = useAnimationControls()
  const reduceMotion = useReducedMotionPreference()
  const tabVariants = useTabPageVariants()
  // 区分首次 mount 与后续 effect 执行。
  // 懒创建场景：新页面 mount 时即 isActive=true（App 先 setActivePage 再加入 visitedPages），
  // 必须在 mount 后播一次进入动画，否则首次访问无动画。
  const isFirstRunRef = useRef(true)
  // 跟踪上一次 isActive，用于检测 false→true / true→false 跳变（首次 mount 后）。
  const prevIsActiveRef = useRef<boolean>(isActive)
  // display 状态：退出页在退出动画完成前保持 block，完成后才置 none。
  // 初值：激活页 block、非激活页 none（与初始 isActive 一致，避免首屏闪烁）。
  const [display, setDisplay] = useState<'block' | 'none'>(isActive ? 'block' : 'none')

  useEffect(() => {
    // 首次 mount：initial variant 已为可见态（opacity:1），不依赖 controls.start 即可见，
    // 避免首次 mount 的 controls 绑定时序竞态导致白屏。首次 mount 跳过进入动画。
    if (isFirstRunRef.current) {
      isFirstRunRef.current = false
      prevIsActiveRef.current = isActive
      return
    }

    const wasActive = prevIsActiveRef.current
    if (isActive && !wasActive) {
      // false → true：切回已存活页面。先确保可见，再播进入动画。
      // 此时 controls 早已绑定（页面非首次 mount），start() 无时序竞态。
      setDisplay('block')
      void controls.start(getTabEnterTarget(direction, reduceMotion))
    } else if (!isActive && wasActive) {
      // true → false：失去激活。播退出动画（期间保持可见），完成后隐藏。
      // 即使 direction===0（同页/边界），也播淡出保持行为一致。
      controls
        .start(getTabExitTarget(direction, reduceMotion))
        .then(() => setDisplay('none'))
        .catch(() => setDisplay('none'))
    }
    prevIsActiveRef.current = isActive
  }, [isActive, direction, controls, reduceMotion])

  return (
    <motion.div
      variants={tabVariants}
      initial="initial"
      animate={controls}
      aria-hidden={!isActive}
      className="absolute inset-0 overflow-auto"
      style={{ display }}
    >
      {children}
    </motion.div>
  )
}
