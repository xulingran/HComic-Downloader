import { describe, it, expect, beforeEach } from 'vitest'
import { useSettingsStore } from '@/stores/useSettingsStore'

// 测试 my_tags 的真实行为逻辑（addMyTag/removeMyTag/addTag 的互斥校验、去重、大小写归一）。
// 这些 action 含项目逻辑（互斥校验、去重），非纯 setState 透传，符合 test-discipline 要求。

describe('useSettingsStore — my_tags 推荐标签', () => {
  beforeEach(() => {
    // 重置 tagBlacklist 与 myTags 为空，避免用例间污染
    useSettingsStore.setState({
      tagBlacklist: { hcomic: [], moeimg: [], jm: [], bika: [], copymanga: [] },
      myTags: { hcomic: [], moeimg: [], jm: [], bika: [], copymanga: [] },
    })
  })

  describe('addMyTag', () => {
    it('成功添加标签返回 true 并写入 state', () => {
      const ok = useSettingsStore.getState().addMyTag('jm', 'NTR')
      expect(ok).toBe(true)
      expect(useSettingsStore.getState().myTags.jm).toEqual(['NTR'])
    })

    it('去除首尾空白后添加', () => {
      const ok = useSettingsStore.getState().addMyTag('jm', '  NTR  ')
      expect(ok).toBe(true)
      expect(useSettingsStore.getState().myTags.jm).toEqual(['NTR'])
    })

    it('空字符串被拒绝返回 false', () => {
      expect(useSettingsStore.getState().addMyTag('jm', '')).toBe(false)
      expect(useSettingsStore.getState().addMyTag('jm', '   ')).toBe(false)
      expect(useSettingsStore.getState().myTags.jm).toEqual([])
    })

    it('超长字符串（>64 字符）被拒绝', () => {
      const long = 'a'.repeat(65)
      expect(useSettingsStore.getState().addMyTag('jm', long)).toBe(false)
      expect(useSettingsStore.getState().myTags.jm).toEqual([])
    })

    it('重复标签（大小写不敏感）被拒绝返回 false', () => {
      useSettingsStore.getState().addMyTag('jm', 'NTR')
      const ok = useSettingsStore.getState().addMyTag('jm', 'ntr')
      expect(ok).toBe(false)
      expect(useSettingsStore.getState().myTags.jm).toEqual(['NTR'])
    })

    it('与 tag_blacklist 互斥：该来源已屏蔽该标签时拒绝加入推荐', () => {
      useSettingsStore.getState().addTag('jm', 'NTR')
      const ok = useSettingsStore.getState().addMyTag('jm', 'NTR')
      expect(ok).toBe(false)
      expect(useSettingsStore.getState().myTags.jm).toEqual([])
    })

    it('互斥校验按来源隔离：jm 屏蔽的标签不影响 hcomic 加入推荐', () => {
      useSettingsStore.getState().addTag('jm', 'NTR')
      const ok = useSettingsStore.getState().addMyTag('hcomic', 'NTR')
      expect(ok).toBe(true)
      expect(useSettingsStore.getState().myTags.hcomic).toEqual(['NTR'])
    })

    it('未知来源键回退到 hcomic（前端 normalizeSourceKey 行为）', () => {
      // 前端 normalizeSourceKey 不做 jmcomic→jm 归一化，未知来源回退到 hcomic
      const ok = useSettingsStore.getState().addMyTag('unknown', 'NTR')
      expect(ok).toBe(true)
      expect(useSettingsStore.getState().myTags.hcomic).toEqual(['NTR'])
    })
  })

  describe('removeMyTag', () => {
    it('移除已存在的标签（大小写不敏感）', () => {
      useSettingsStore.getState().addMyTag('jm', 'NTR')
      useSettingsStore.getState().removeMyTag('jm', 'ntr')
      expect(useSettingsStore.getState().myTags.jm).toEqual([])
    })

    it('移除不存在的标签是安全的（无副作用）', () => {
      useSettingsStore.getState().addMyTag('jm', 'NTR')
      useSettingsStore.getState().removeMyTag('jm', 'not-present')
      expect(useSettingsStore.getState().myTags.jm).toEqual(['NTR'])
    })
  })

  describe('addTag（黑名单）与 my_tags 的反向互斥', () => {
    it('该来源已推荐该标签时拒绝加入黑名单', () => {
      useSettingsStore.getState().addMyTag('jm', 'NTR')
      const ok = useSettingsStore.getState().addTag('jm', 'NTR')
      expect(ok).toBe(false)
      expect(useSettingsStore.getState().tagBlacklist.jm).toEqual([])
    })

    it('反向互斥按来源隔离', () => {
      useSettingsStore.getState().addMyTag('jm', 'NTR')
      const ok = useSettingsStore.getState().addTag('hcomic', 'NTR')
      expect(ok).toBe(true)
      expect(useSettingsStore.getState().tagBlacklist.hcomic).toEqual(['NTR'])
    })
  })

  describe('setMyTags', () => {
    it('整体替换 myTags 并保留各来源独立 [derived]', () => {
      // [derived] setMyTags 用于初始化加载，派生契约是「整体替换不污染既有来源键」。
      // 先建立非空基线，验证替换后旧值被清除、各来源独立。
      useSettingsStore.getState().addMyTag('bika', 'old')
      useSettingsStore.getState().setMyTags({
        hcomic: ['a'], moeimg: ['b'], jm: ['c'], bika: [], copymanga: [],
      })
      // bika 旧值 'old' 必须被整体替换清除（派生：替换 vs 合并的语义）
      expect(useSettingsStore.getState().myTags.bika).toEqual([])
      expect(useSettingsStore.getState().myTags.hcomic).toEqual(['a'])
      expect(useSettingsStore.getState().myTags.jm).toEqual(['c'])
    })
  })

  describe('持久化订阅 subscribeToMyTagsChanges', () => {
    it('myTags 变更时触发 setConfig("myTags", ...)', async () => {
      const { subscribeToMyTagsChanges } = await import('@/stores/useSettingsStore')
      const calls: Array<{ key: string; value: unknown }> = []
      const setConfig = (key: 'myTags', value: unknown) => {
        calls.push({ key, value })
        return Promise.resolve()
      }
      const unsub = subscribeToMyTagsChanges(setConfig)
      try {
        useSettingsStore.getState().addMyTag('jm', 'NTR')
        // zustand 订阅是同步触发的
        expect(calls.length).toBeGreaterThanOrEqual(1)
        expect(calls[calls.length - 1].key).toBe('myTags')
      } finally {
        unsub()
      }
    })

    it('非 myTags 的 state 变更不触发 setConfig [derived]', async () => {
      // [derived] 验证订阅的选择性：myTags 订阅只对 myTags 变更敏感，themeMode 变更不得触发。
      const { subscribeToMyTagsChanges } = await import('@/stores/useSettingsStore')
      const calls: unknown[] = []
      const setConfig = (_key: 'myTags', _value: unknown) => {
        calls.push(_value)
        return Promise.resolve()
      }
      const unsub = subscribeToMyTagsChanges(setConfig)
      try {
        useSettingsStore.getState().setThemeMode('dark')
        expect(calls.length).toBe(0)
      } finally {
        unsub()
      }
    })
  })
})
