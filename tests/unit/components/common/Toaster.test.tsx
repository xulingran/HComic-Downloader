import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { Toaster } from '@/components/common/Toaster'
import { useToastStore } from '@/stores/useToastStore'

describe('Toaster', () => {
  beforeEach(() => {
    useToastStore.setState({ toast: { message: '', type: 'info', visible: false } })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('visible 为 false 时不渲染内容', () => {
    const { container } = render(<Toaster />)
    expect(container.firstChild).toBeNull()
  })

  it('store 有可见 toast 时渲染消息', async () => {
    render(<Toaster />)
    useToastStore.getState().error('操作失败')

    await vi.waitFor(() => {
      expect(screen.getByText('操作失败')).toBeInTheDocument()
    })
  })

  it('4 秒后自动 dismiss', async () => {
    render(<Toaster />)
    useToastStore.getState().show('瞬态消息')

    await vi.waitFor(() => {
      expect(screen.getByText('瞬态消息')).toBeInTheDocument()
    })

    // 快进 4 秒，触发自动消失
    act(() => {
      vi.advanceTimersByTime(4000)
    })

    expect(useToastStore.getState().toast.visible).toBe(false)
  })
})
