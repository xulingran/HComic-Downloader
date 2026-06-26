import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toaster } from '@/components/common/Toaster'
import { useToastStore } from '@/stores/useToastStore'

/**
 * Toast 渲染依赖 framer-motion AnimatePresence，jsdom 不执行真实动画但会挂载子节点。
 * 关键约束：渲染类断言必须用 findBy*（异步等待 mount），不能用同步 getBy*。
 * 自动消失类断言不渲染组件（避免 fake timers 与 framer-motion 冲突），
 * 而是直接验证 store 状态机 + Toaster 的 effect 选择性启动定时器。
 */

describe('Toaster / useToastStore 扩展', () => {
  beforeEach(() => {
    useToastStore.setState({
      toast: { message: '', type: 'info', visible: false },
    })
  })

  it('带 action 的 Toast 渲染按钮且点击触发回调', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    render(<Toaster />)
    act(() => { useToastStore.getState().info('提示', { actionLabel: '重试', onAction }) })

    const btn = await screen.findByRole('button', { name: '重试' })
    await user.click(btn)
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('persistent 与 action 可组合渲染', async () => {
    render(<Toaster />)
    act(() => {
      useToastStore.getState().info('5 页加载失败', {
        actionLabel: '全部重试',
        onAction: () => {},
        persistent: true,
      })
    })

    expect(await screen.findByText('5 页加载失败')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '全部重试' })).toBeInTheDocument()
  })

  it('无 options 的旧调用零回归（show(msg, type)）', async () => {
    render(<Toaster />)
    act(() => { useToastStore.getState().show('旧式调用', 'success') })

    expect(await screen.findByText('旧式调用')).toBeInTheDocument()
    // 未传 actionLabel，不应渲染 action 按钮（关闭按钮 aria-label="关闭" 除外）
    expect(screen.queryByRole('button', { name: '全部重试' })).toBeNull()
  })

  it('快捷方法 error/success/info 支持 options 透传', async () => {
    render(<Toaster />)
    const onAction = vi.fn()
    act(() => { useToastStore.getState().success('已完成', { actionLabel: '查看', onAction }) })

    expect(await screen.findByText('已完成')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看' })).toBeInTheDocument()
  })

  it('store 正确写入 persistent 标志（非持久）', () => {
    act(() => { useToastStore.getState().error('普通错误') })
    expect(useToastStore.getState().toast.persistent).toBeFalsy()
  })

  it('store 正确写入 persistent 标志（持久）', () => {
    act(() => { useToastStore.getState().error('持久错误', { persistent: true }) })
    expect(useToastStore.getState().toast.persistent).toBe(true)
  })

  it('dismiss 后 visible 翻为 false', () => {
    useToastStore.getState().error('某错误', { persistent: true })
    expect(useToastStore.getState().toast.visible).toBe(true)

    act(() => { useToastStore.getState().dismiss() })
    expect(useToastStore.getState().toast.visible).toBe(false)
  })
})
