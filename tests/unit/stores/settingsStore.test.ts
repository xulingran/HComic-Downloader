import { describe, it, expect, beforeEach } from 'vitest'
import { useSettingsStore } from '@/stores/useSettingsStore'

describe('useSettingsStore', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      themeMode: 'auto',
      cardStyle: 'cover'
    })
  })

  it('应有正确的初始状态', () => {
    const state = useSettingsStore.getState()
    expect(state.themeMode).toBe('auto')
    expect(state.cardStyle).toBe('cover')
  })

  it('应能设置 themeMode', () => {
    useSettingsStore.getState().setThemeMode('dark')
    expect(useSettingsStore.getState().themeMode).toBe('dark')
  })

  it('应能设置 cardStyle', () => {
    useSettingsStore.getState().setCardStyle('detailed')
    expect(useSettingsStore.getState().cardStyle).toBe('detailed')
  })

  it('应能切换所有主题模式', () => {
    const modes = ['light', 'dark', 'auto'] as const
    modes.forEach((mode) => {
      useSettingsStore.getState().setThemeMode(mode)
      expect(useSettingsStore.getState().themeMode).toBe(mode)
    })
  })
})
