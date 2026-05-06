import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DownloadTask, ComicInfo } from '@shared/types'

// Hoist mock functions so they are available inside vi.mock factories
const { mockGetDownloads, mockCancelDownload, mockStoreState } = vi.hoisted(() => {
  const state = {
    tasks: [] as DownloadTask[],
    setTasks: vi.fn(),
    updateTask: vi.fn()
  }
  return {
    mockGetDownloads: vi.fn(),
    mockCancelDownload: vi.fn(),
    mockStoreState: state
  }
})

vi.mock('@/hooks/useIpc', () => ({
  useDownload: vi.fn().mockReturnValue({
    getDownloads: mockGetDownloads,
    cancelDownload: mockCancelDownload,
    startDownload: vi.fn()
  })
}))

vi.mock('@/stores/useDownloadStore', () => ({
  useDownloadStore: vi.fn(() => mockStoreState)
}))

vi.mock('@/components/common/ProgressBar', () => ({
  ProgressBar: ({ progress, status }: { progress: number; status: string }) => (
    <div data-testid="progress-bar">
      {progress}% - {status}
    </div>
  )
}))

// Import the component AFTER mocks
import { DownloadPage } from '@/pages/DownloadPage'

const mockComic: ComicInfo = {
  id: '1',
  title: 'Test Comic',
  url: 'https://example.com/comic/1',
  coverUrl: 'https://example.com/cover.jpg',
  source: 'test'
}

describe('DownloadPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreState.tasks = []
    mockGetDownloads.mockResolvedValue({ tasks: [] })
    mockCancelDownload.mockResolvedValue({ success: true })
  })

  it('renders page content with title', () => {
    render(<DownloadPage />)

    expect(screen.getByText('下载管理')).toBeInTheDocument()
  })

  it('renders refresh button', () => {
    render(<DownloadPage />)

    expect(screen.getByText('刷新')).toBeInTheDocument()
  })

  it('shows empty state when no tasks', () => {
    render(<DownloadPage />)

    expect(screen.getByText('暂无下载任务')).toBeInTheDocument()
  })

  it('shows download tasks when they exist', () => {
    const tasks: DownloadTask[] = [
      {
        id: 'task-1',
        comic: mockComic,
        status: 'downloading',
        progress: 45,
        totalPages: 20,
        downloadedPages: 9
      }
    ]
    mockStoreState.tasks = tasks

    render(<DownloadPage />)

    expect(screen.getByText('Test Comic')).toBeInTheDocument()
    expect(screen.queryByText('暂无下载任务')).not.toBeInTheDocument()
  })

  it('shows cancel button for downloading tasks', () => {
    const tasks: DownloadTask[] = [
      {
        id: 'task-1',
        comic: mockComic,
        status: 'downloading',
        progress: 45,
        totalPages: 20,
        downloadedPages: 9
      }
    ]
    mockStoreState.tasks = tasks

    render(<DownloadPage />)

    expect(screen.getByText('取消')).toBeInTheDocument()
  })

  it('does not show cancel button for completed tasks', () => {
    const tasks: DownloadTask[] = [
      {
        id: 'task-1',
        comic: mockComic,
        status: 'completed',
        progress: 100,
        totalPages: 20,
        downloadedPages: 20
      }
    ]
    mockStoreState.tasks = tasks

    render(<DownloadPage />)

    expect(screen.queryByText('取消')).not.toBeInTheDocument()
  })

  it('shows error message for failed tasks', () => {
    const tasks: DownloadTask[] = [
      {
        id: 'task-1',
        comic: mockComic,
        status: 'error',
        progress: 30,
        totalPages: 20,
        downloadedPages: 6,
        error: 'Network timeout'
      }
    ]
    mockStoreState.tasks = tasks

    render(<DownloadPage />)

    expect(screen.getByText('Network timeout')).toBeInTheDocument()
  })

  it('calls getDownloads on mount', () => {
    render(<DownloadPage />)

    expect(mockGetDownloads).toHaveBeenCalled()
  })

  it('can trigger refresh', async () => {
    render(<DownloadPage />)

    const refreshButton = screen.getByText('刷新')
    await userEvent.click(refreshButton)

    expect(mockGetDownloads).toHaveBeenCalledTimes(2) // once on mount, once on click
  })
})
