import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProgressBar } from '@/components/common/ProgressBar'

describe('ProgressBar', () => {
  it('shows page count for downloading status', () => {
    render(<ProgressBar progress={65} status="downloading" totalPages={75} downloadedPages={11} />)
    expect(screen.getByText('11 / 75')).toBeInTheDocument()
  })

  it('shows 已完成 for completed status', () => {
    render(<ProgressBar progress={100} status="completed" totalPages={75} downloadedPages={75} />)
    expect(screen.getByText('完成')).toBeInTheDocument()
  })

  it('shows 失败 for failed status', () => {
    render(<ProgressBar progress={30} status="failed" totalPages={75} downloadedPages={23} />)
    expect(screen.getByText('失败')).toBeInTheDocument()
  })

  it('shows 排队中 for queued status', () => {
    render(<ProgressBar progress={0} status="queued" totalPages={75} downloadedPages={0} />)
    expect(screen.getByText('排队中')).toBeInTheDocument()
  })

  it('shows 已取消 for cancelled status', () => {
    render(<ProgressBar progress={50} status="cancelled" totalPages={75} downloadedPages={35} />)
    expect(screen.getByText('已取消')).toBeInTheDocument()
  })
})
