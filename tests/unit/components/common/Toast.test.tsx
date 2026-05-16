import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toast } from '@/components/common/Toast'

describe('Toast', () => {
  it('renders nothing when visible is false', () => {
    const { container } = render(
      <Toast message="测试消息" visible={false} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders message when visible is true', async () => {
    render(<Toast message="测试消息" visible={true} />)

    await vi.waitFor(() => {
      expect(screen.getByText('测试消息')).toBeInTheDocument()
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
    const { rerender, container } = render(
      <Toast message="测试消息" visible={true} />
    )

    await vi.waitFor(() => {
      expect(screen.getByText('测试消息')).toBeInTheDocument()
    })

    rerender(<Toast message="测试消息" visible={false} />)

    await vi.waitFor(() => {
      expect(container.firstChild).toBeNull()
    })
  })
})
