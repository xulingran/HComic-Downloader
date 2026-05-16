import { describe, it, expect, beforeEach } from 'vitest'
import { useSettingsStore } from '@/stores/useSettingsStore'

describe('useSettingsStore', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      themeMode: 'auto',
      cardStyle: 'cover',
      sfwMode: false,
      sfwToastDismissed: false
    })
  })

  it('应有正确的初始状态', () => {
    const state = useSettingsStore.getState()
    expect(state.themeMode).toBe('auto')
    expect(state.cardStyle).toBe('cover')
    expect(state.sfwMode).toBe(false)
    expect(state.sfwToastDismissed).toBe(false)
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

  it('应能设置 sfwMode', () => {
    useSettingsStore.getState().setSfwMode(true)
    expect(useSettingsStore.getState().sfwMode).toBe(true)

    useSettingsStore.getState().setSfwMode(false)
    expect(useSettingsStore.getState().sfwMode).toBe(false)
  })

  it('应能通过 dismissSfwToast 设置 sfwToastDismissed', () => {
    expect(useSettingsStore.getState().sfwToastDismissed).toBe(false)
    useSettingsStore.getState().dismissSfwToast()
    expect(useSettingsStore.getState().sfwToastDismissed).toBe(true)
  })
})
