/**
 * keep-alive tab 页面容器。
 *
 * App 集中协调 hidden / visible / exiting / entering 阶段，本组件只执行属于
 * 自己的单个动画命令并回报完成。页面切走后仅 display:none，不卸载组件树。
 */
import { useLayoutEffect, type ReactNode } from 'react'
import { motion, useAnimationControls } from 'framer-motion'
import { getTabPageEnterStart, getTabPageEnterTarget, getTabPageExitTarget } from '@/lib/anim'

export type TabPagePhase = 'hidden' | 'visible' | 'exiting' | 'entering'

interface KeepAlivePageProps {
  page: string
  phase: TabPagePhase
  /** 当前阶段的导航方向（+1 向右 / -1 向左 / 0 同页）。 */
  direction: number
  /** 用于拒绝过期动画完成结果的单调递增标识。 */
  transitionId: number
  onPhaseComplete: (page: string, phase: 'exiting' | 'entering', transitionId: number) => void
  children: ReactNode
}

export function KeepAlivePage({
  page,
  phase,
  direction,
  transitionId,
  onPhaseComplete,
  children,
}: KeepAlivePageProps) {
  const controls = useAnimationControls()

  useLayoutEffect(() => {
    let cancelled = false
    let frame = 0

    controls.stop()
    if (phase === 'hidden' || phase === 'visible') {
      controls.set({ x: 0, opacity: 1 })
    } else if (phase === 'exiting') {
      void controls.start(getTabPageExitTarget(direction)).then(() => {
        if (!cancelled) onPhaseComplete(page, 'exiting', transitionId)
      })
    } else {
      // layout effect 在浏览器绘制前设置进入起点；下一帧再启动动画，确保首次挂载的
      // controls 已绑定且不会短暂以最终态覆盖退出页。
      controls.set(getTabPageEnterStart(direction))
      frame = requestAnimationFrame(() => {
        void controls.start(getTabPageEnterTarget()).then(() => {
          if (!cancelled) onPhaseComplete(page, 'entering', transitionId)
        })
      })
    }

    return () => {
      cancelled = true
      if (frame) cancelAnimationFrame(frame)
      controls.stop()
    }
  }, [controls, direction, onPhaseComplete, page, phase, transitionId])

  const isDisplayed = phase !== 'hidden'

  return (
    <motion.div
      initial={false}
      animate={controls}
      aria-hidden={phase !== 'visible'}
      data-tab-page={page}
      data-tab-phase={phase}
      data-tab-visible={isDisplayed ? 'true' : 'false'}
      className="absolute inset-0 overflow-auto"
      style={{ display: isDisplayed ? 'block' : 'none', pointerEvents: phase === 'visible' ? 'auto' : 'none' }}
    >
      {children}
    </motion.div>
  )
}
