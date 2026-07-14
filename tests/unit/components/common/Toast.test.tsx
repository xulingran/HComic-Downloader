import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toast } from '@/components/common/Toast'

describe('Toast', () => {
  it('renders nothing when visible is false', () => {
    const { container } = render(
      <Toast message="测试消息" visible={false} />
    )
    // 变更 2：Toast 外层定位 div 总是渲染（用于 left-1/2 居中），
    // visible=false 时内部 message 不渲染（AnimatePresence 控制）。
    expect(screen.queryByText('测试消息')).toBeNull()
    expect(container.firstElementChild).toHaveClass('pointer-events-none')
  })

  it('renders message when visible is true', async () => {
    render(<Toast message="测试消息" visible={true} />)

    await vi.waitFor(() => {
      const message = screen.getByText('测试消息')
      expect(message).toBeInTheDocument()
      expect(message.parentElement).toHaveClass('pointer-events-auto')
    })
  })

  it('renders action button when actionLabel and onAction are provided', async () => {
    const onAction = vi.fn()
    render(
      <Toast
        message="测试消息"
        actionLabel="点击我"
        onAction={onAction}
        visible={true}
      />
    )

    await vi.waitFor(() => {
      const button = screen.getByText('点击我')
      expect(button).toBeInTheDocument()
    })
  })

  it('calls onAction when action button is clicked', async () => {
    const onAction = vi.fn()
    render(
      <Toast
        message="测试消息"
        actionLabel="点击我"
        onAction={onAction}
        visible={true}
      />
    )

    await vi.waitFor(() => {
      expect(screen.getByText('点击我')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText('点击我'))
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('calls onDismiss when close button is clicked', async () => {
    const onDismiss = vi.fn()
    render(
      <Toast
        message="测试消息"
        onDismiss={onDismiss}
        visible={true}
      />
    )

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('does not render action button when onAction is not provided', async () => {
    render(
      <Toast
        message="测试消息"
        actionLabel="点击我"
        visible={true}
      />
    )

    await vi.waitFor(() => {
      expect(screen.getByText('测试消息')).toBeInTheDocument()
    })

    expect(screen.queryByText('点击我')).toBeNull()
  })

  it('hides when visible changes from true to false', async () => {
    const { rerender } = render(
      <Toast message="测试消息" visible={true} />
    )

    await vi.waitFor(() => {
      expect(screen.getByText('测试消息')).toBeInTheDocument()
    })

    rerender(<Toast message="测试消息" visible={false} />)

    await vi.waitFor(() => {
      expect(screen.queryByText('测试消息')).toBeNull()
    })
  })
})
