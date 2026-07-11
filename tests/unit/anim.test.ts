import { describe, it, expect } from 'vitest'
import {
  smoothTransition,
  DURATION,
  getTabPageEnterTarget,
  getTabPageExitTarget,
  getReducedTabPageEnterTarget,
  getReducedTabPageExitTarget,
  getTabEnterTarget,
  getTabExitTarget,
  TAB_ORDER,
} from '@/lib/anim'

describe('tab page animation targets', () => {
  describe('getTabPageEnterTarget（完整路径）', () => {
    it('向右导航时进入目标滑回原位并淡入', () => {
      const target = getTabPageEnterTarget(1)
      expect(target.x).toBe(0)
      expect(target.opacity).toBe(1)
      expect(target.transition).toBe(smoothTransition)
    })

    it('向左导航时进入目标同样滑回原位（方向对称）', () => {
      const target = getTabPageEnterTarget(-1)
      expect(target.x).toBe(0)
      expect(target.opacity).toBe(1)
    })
  })

  describe('getTabPageExitTarget（完整路径）', () => {
    it('向右导航时旧页向左滑出', () => {
      const target = getTabPageExitTarget(1)
      expect(target.x).toBe('-8%')
      expect(target.opacity).toBe(0)
      expect(target.transition).toBe(smoothTransition)
    })

    it('向左导航时旧页向右滑出', () => {
      const target = getTabPageExitTarget(-1)
      expect(target.x).toBe('8%')
      expect(target.opacity).toBe(0)
    })

    it('方向为 0 时退出无位移（仅淡出）', () => {
      const target = getTabPageExitTarget(0)
      expect(target.x).toBe(0)
      expect(target.opacity).toBe(0)
    })
  })

  describe('getReducedTabPageEnterTarget / ExitTarget（reduced-motion）', () => {
    it('进入目标无 x 位移，纯 opacity 淡入', () => {
      const target = getReducedTabPageEnterTarget()
      expect(target.x).toBeUndefined()
      expect(target.opacity).toBe(1)
    })

    it('退出目标无 x 位移，纯 opacity 淡出', () => {
      const target = getReducedTabPageExitTarget()
      expect(target.x).toBeUndefined()
      expect(target.opacity).toBe(0)
    })

    it('时长均为 DURATION.fast（150ms）', () => {
      expect(getReducedTabPageEnterTarget().transition).toMatchObject({ duration: DURATION.fast })
      expect(getReducedTabPageExitTarget().transition).toMatchObject({ duration: DURATION.fast })
    })
  })
})

describe('getTabEnterTarget / getTabExitTarget（reduced-motion 分发）', () => {
  it('reducedMotion=false 时走完整路径（含 x 位移）', () => {
    const enter = getTabEnterTarget(1, false)
    expect(enter.x).toBe(0)
    expect(enter.opacity).toBe(1)

    const exit = getTabExitTarget(1, false)
    expect(exit.x).toBe('-8%')
    expect(exit.opacity).toBe(0)
  })

  it('reducedMotion=true 时走纯 opacity 路径（无 x 位移）', () => {
    const enter = getTabEnterTarget(1, true)
    expect(enter.x).toBeUndefined()
    expect(enter.opacity).toBe(1)

    const exit = getTabExitTarget(-1, true)
    expect(exit.x).toBeUndefined()
    expect(exit.opacity).toBe(0)
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
