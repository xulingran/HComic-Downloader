import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FatalBanner } from '@/components/FatalBanner'
import { useFatalErrorStore } from '@/stores/useFatalErrorStore'

describe('FatalBanner', () => {
  beforeEach(() => {
    useFatalErrorStore.setState({ error: null })
  })

  it('无致命错误时不渲染', () => {
    const { container } = render(<FatalBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('有致命错误时渲染错误消息', () => {
    useFatalErrorStore.getState().setError({ message: '后端服务异常', kind: 'backend-spawn' })
    render(<FatalBanner />)
    expect(screen.getByText('后端服务异常')).toBeInTheDocument()
  })

  it('渲染复制诊断日志按钮', () => {
    useFatalErrorStore.getState().setError({ message: '异常' })
    render(<FatalBanner />)
    expect(screen.getByText('复制诊断日志')).toBeInTheDocument()
  })

  it('点击关闭按钮清除错误', async () => {
    useFatalErrorStore.getState().setError({ message: '异常' })
    render(<FatalBanner />)
    await userEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(useFatalErrorStore.getState().error).toBeNull()
  })

  it('具有 alert role 以便无障碍访问', () => {
    useFatalErrorStore.getState().setError({ message: '异常' })
    render(<FatalBanner />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
