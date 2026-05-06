import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProgressBar } from '@/components/common/ProgressBar'

describe('ProgressBar', () => {
  it('shows percentage for downloading status', () => {
    render(<ProgressBar progress={65} status="downloading" />)
    expect(screen.getByText('65%')).toBeInTheDocument()
  })

  it('shows 已完成 for completed status', () => {
    render(<ProgressBar progress={100} status="completed" />)
    expect(screen.getByText('完成')).toBeInTheDocument()
  })

  it('shows 失败 for error status', () => {
    render(<ProgressBar progress={30} status="error" />)
    expect(screen.getByText('失败')).toBeInTheDocument()
  })

  it('shows 等待中 for pending status', () => {
    render(<ProgressBar progress={0} status="pending" />)
    expect(screen.getByText('等待中')).toBeInTheDocument()
  })

  it('shows 已取消 for cancelled status', () => {
    render(<ProgressBar progress={50} status="cancelled" />)
    expect(screen.getByText('已取消')).toBeInTheDocument()
  })
})
