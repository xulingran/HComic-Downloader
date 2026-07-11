import { describe, it, expect } from 'vitest'
import {
  DURATION,
  getTabPageEnterStart,
  getTabPageEnterTarget,
  getTabPageExitTarget,
  tabPhaseTransition,
  TAB_ORDER,
} from '@/lib/anim'

describe('tab fade-through animation targets', () => {
  it('向右导航时旧页向左退出、新页从右侧进入', () => {
    expect(getTabPageExitTarget(1)).toMatchObject({ x: '-8%', opacity: 0 })
    expect(getTabPageEnterStart(1)).toEqual({ x: '8%', opacity: 0 })
    expect(getTabPageEnterTarget()).toMatchObject({ x: 0, opacity: 1 })
  })

  it('向左导航时旧页向右退出、新页从左侧进入', () => {
    expect(getTabPageExitTarget(-1)).toMatchObject({ x: '8%', opacity: 0 })
    expect(getTabPageEnterStart(-1)).toEqual({ x: '-8%', opacity: 0 })
  })

  it('方向为 0 时只执行顺序淡出和淡入', () => {
    expect(getTabPageExitTarget(0)).toMatchObject({ x: 0, opacity: 0 })
    expect(getTabPageEnterStart(0)).toEqual({ x: 0, opacity: 0 })
  })

  it('进入和退出各使用 150ms，总时长为 300ms', () => {
    expect(tabPhaseTransition).toMatchObject({ type: 'tween', duration: DURATION.fast })
    expect(getTabPageExitTarget(1).transition).toBe(tabPhaseTransition)
    expect(getTabPageEnterTarget().transition).toBe(tabPhaseTransition)
    expect(DURATION.fast * 2).toBe(DURATION.slow)
  })

  it('reduced-motion 由协调器瞬时切换，不存在独立透明度动画目标', async () => {
    const exports = await import('@/lib/anim')
    expect(exports).not.toHaveProperty('getReducedTabPageEnterTarget')
    expect(exports).not.toHaveProperty('getReducedTabPageExitTarget')
  })
})

describe('TAB_ORDER', () => {
  it('与 Sidebar 菜单顺序一致（8 个 tab）', () => {
    expect(TAB_ORDER).toEqual([
      'search', 'downloads', 'favourites', 'history',
      'toolbox', 'maintenance', 'settings', 'about',
    ])
  })
})
