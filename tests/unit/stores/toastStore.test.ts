import { describe, it, expect, beforeEach } from 'vitest'
import { useToastStore } from '@/stores/useToastStore'

describe('useToastStore', () => {
  beforeEach(() => {
    // 重置为初始状态（visible: false）
    useToastStore.getState().dismiss()
    useToastStore.setState({ toast: { message: '', type: 'info', visible: false } })
  })

  it('应有正确的初始状态', () => {
    const state = useToastStore.getState()
    expect(state.toast.visible).toBe(false)
    expect(state.toast.message).toBe('')
    expect(state.toast.type).toBe('info')
  })

  it('show 应设置 message、type 默认 info、visible 为 true', () => {
    useToastStore.getState().show('测试消息')
    const state = useToastStore.getState()
    expect(state.toast.message).toBe('测试消息')
    expect(state.toast.type).toBe('info')
    expect(state.toast.visible).toBe(true)
  })

  it('show 应支持指定 type', () => {
    useToastStore.getState().show('出错了', 'error')
    const state = useToastStore.getState()
    expect(state.toast.type).toBe('error')
    expect(state.toast.visible).toBe(true)
  })

  it('error 快捷方式应设置 type 为 error', () => {
    useToastStore.getState().error('下载失败')
    const state = useToastStore.getState()
    expect(state.toast.type).toBe('error')
    expect(state.toast.message).toBe('下载失败')
    expect(state.toast.visible).toBe(true)
  })

  it('success 快捷方式应设置 type 为 success', () => {
    useToastStore.getState().success('复制成功')
    expect(useToastStore.getState().toast.type).toBe('success')
  })

  it('info 快捷方式应设置 type 为 info', () => {
    useToastStore.getState().info('提示')
    expect(useToastStore.getState().toast.type).toBe('info')
  })

  it('dismiss 应将 visible 设为 false', () => {
    useToastStore.getState().show('消息')
    expect(useToastStore.getState().toast.visible).toBe(true)
    useToastStore.getState().dismiss()
    expect(useToastStore.getState().toast.visible).toBe(false)
  })

  it('新 show 应覆盖旧的（单例）', () => {
    useToastStore.getState().show('第一条')
    useToastStore.getState().show('第二条')
    expect(useToastStore.getState().toast.message).toBe('第二条')
  })
})
