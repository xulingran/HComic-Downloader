import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { mockGetStatistics } = vi.hoisted(() => ({
  mockGetStatistics: vi.fn()
}))

vi.mock('@/hooks/useIpc', () => ({
  useStatistics: vi.fn().mockReturnValue({ getStatistics: mockGetStatistics })
}))

import { StatisticsPage } from '@/pages/StatisticsPage'

const mockStats = {
  totalDownloads: 100,
  completedDownloads: 80,
  failedDownloads: 20,
  totalSize: 1073741824, // 1 GB
  downloadsByDay: [
    { date: '2026-01-01', count: 10 },
    { date: '2026-01-02', count: 20 },
    { date: '2026-01-03', count: 5 }
  ]
}

describe('StatisticsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls getStatistics on mount', async () => {
    mockGetStatistics.mockResolvedValue(mockStats)

    render(<StatisticsPage />)

    await waitFor(() => {
      expect(mockGetStatistics).toHaveBeenCalledTimes(1)
    })
  })

  it('shows loading state initially', () => {
    mockGetStatistics.mockReturnValue(new Promise(() => {})) // never resolves

    render(<StatisticsPage />)

    expect(screen.getByText('加载中...')).toBeInTheDocument()
  })

  it('shows error state when getStatistics returns null', async () => {
    mockGetStatistics.mockResolvedValue(null)

    render(<StatisticsPage />)

    await waitFor(() => {
      expect(screen.getByText('无法加载统计数据')).toBeInTheDocument()
    })
  })

  it('shows error state when getStatistics throws', async () => {
    mockGetStatistics.mockRejectedValue(new Error('IPC error'))

    render(<StatisticsPage />)

    await waitFor(() => {
      expect(screen.getByText('无法加载统计数据')).toBeInTheDocument()
    })
  })

  it('renders statistics data correctly', async () => {
    mockGetStatistics.mockResolvedValue(mockStats)

    render(<StatisticsPage />)

    await waitFor(() => {
      expect(screen.getByText('数据统计')).toBeInTheDocument()
    })

    expect(screen.getByText('100')).toBeInTheDocument() // totalDownloads
    expect(screen.getByText('80')).toBeInTheDocument() // completedDownloads
    expect(screen.getByText('20')).toBeInTheDocument() // failedDownloads
    expect(screen.getByText('1 GB')).toBeInTheDocument() // totalSize
  })

  it('renders stat cards with correct titles', async () => {
    mockGetStatistics.mockResolvedValue(mockStats)

    render(<StatisticsPage />)

    await waitFor(() => {
      expect(screen.getByText('总下载')).toBeInTheDocument()
    })
    expect(screen.getByText('已完成')).toBeInTheDocument()
    expect(screen.getByText('失败')).toBeInTheDocument()
    expect(screen.getByText('总大小')).toBeInTheDocument()
  })

  it('shows success rate in failed stat card subtitle', async () => {
    mockGetStatistics.mockResolvedValue(mockStats)

    render(<StatisticsPage />)

    await waitFor(() => {
      expect(screen.getByText('80% 成功率')).toBeInTheDocument()
    })
  })

  it('shows 0% success rate when totalDownloads is 0', async () => {
    mockGetStatistics.mockResolvedValue({
      ...mockStats,
      totalDownloads: 0,
      completedDownloads: 0,
      failedDownloads: 0
    })

    render(<StatisticsPage />)

    await waitFor(() => {
      expect(screen.getByText('0% 成功率')).toBeInTheDocument()
    })
  })

  it('renders downloads trend chart when data exists', async () => {
    mockGetStatistics.mockResolvedValue(mockStats)

    render(<StatisticsPage />)

    await waitFor(() => {
      expect(screen.getByText('下载趋势')).toBeInTheDocument()
    })

    // Check date labels are displayed (show date.slice(5))
    expect(screen.getByText('01-01')).toBeInTheDocument()
    expect(screen.getByText('01-02')).toBeInTheDocument()
    expect(screen.getByText('01-03')).toBeInTheDocument()
  })

  it('does not render trend chart when downloadsByDay is empty', async () => {
    mockGetStatistics.mockResolvedValue({
      ...mockStats,
      downloadsByDay: []
    })

    render(<StatisticsPage />)

    await waitFor(() => {
      expect(screen.getByText('数据统计')).toBeInTheDocument()
    })

    expect(screen.queryByText('下载趋势')).not.toBeInTheDocument()
  })

  it('refresh button calls getStatistics again', async () => {
    mockGetStatistics.mockResolvedValue(mockStats)

    render(<StatisticsPage />)

    await waitFor(() => {
      expect(screen.getByText('刷新')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText('刷新'))

    await waitFor(() => {
      expect(mockGetStatistics).toHaveBeenCalledTimes(2)
    })
  })
})
