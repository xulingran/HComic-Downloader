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

  it('shows 失败 for failed status', () => {
    render(<ProgressBar progress={30} status="failed" />)
    expect(screen.getByText('失败')).toBeInTheDocument()
  })

  it('shows 排队中 for queued status', () => {
    render(<ProgressBar progress={0} status="queued" />)
    expect(screen.getByText('排队中')).toBeInTheDocument()
  })

  it('shows 已取消 for cancelled status', () => {
    render(<ProgressBar progress={50} status="cancelled" />)
    expect(screen.getByText('已取消')).toBeInTheDocument()
  })
})
