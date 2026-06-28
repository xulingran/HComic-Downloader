import { describe, it, expect, beforeEach } from 'vitest'
import { useSettingsStore } from '@/stores/useSettingsStore'

// 测试精简记录（test-discipline-gate Phase 1 / test-discipline "禁止测试框架的基本保证"）：
// 已删除以下用例，它们验证 Zustand setState/getState 的框架基本保证，store 实现为
// 单行透传 `(x) => set({ x })`，无项目代码信号：
//   - "应能设置 themeMode"（setThemeMode: (mode) => set({ themeMode: mode })）
//   - "应能设置 cardStyle"（setCardStyle: (style) => set({ cardStyle: style })）
//   - "应能设置 sfwMode"（setSfwMode: (enabled) => set({ sfwMode: enabled })）
//   - "应能通过 dismissSfwToast 设置 sfwToastDismissed"（dismissSfwToast: () => set({ sfwToastDismissed: true })）
//   - "defaultFavouriteSource 默认为空字符串且可设置"（setDefaultFavouriteSource: (source) => set({ defaultFavouriteSource: source })）
// 保留"应能切换所有主题模式"——参数化遍历枚举集合，含"枚举值集合契约"的弱派生信号
// （store 的 ThemeMode 类型与值集合一致性）。
// 注：useSettingsStore 内含派生逻辑的方法（addTag/addDuplicateIgnore 等）未在此文件测试，
// 其行为由各自组件/集成测试覆盖。

describe('useSettingsStore', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      themeMode: 'auto',
      cardStyle: 'cover',
      sfwMode: false,
      sfwToastDismissed: false
    })
  })

  it('应能切换所有主题模式', () => {
    const modes = ['light', 'dark', 'auto'] as const
    modes.forEach((mode) => {
      useSettingsStore.getState().setThemeMode(mode)
      expect(useSettingsStore.getState().themeMode).toBe(mode)
    })
  })
})
