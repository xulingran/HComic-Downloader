import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DownloadTask, ComicInfo } from '@shared/types'

// Hoist mock functions so they are available inside vi.mock factories
const {
  mockGetDownloads,
  mockCancelDownload,
  mockGetConfig,
  mockOpenDownloadDir,
  mockHandlePauseTask,
  mockHandleRetryTask,
  mockStoreState,
} = vi.hoisted(() => {
  const state = {
    tasks: [] as DownloadTask[],
    setTasks: vi.fn(),
    addTask: vi.fn(),
    updateTask: vi.fn(),
    isGloballyPaused: false,
    getState: () => ({ tasks: state.tasks, isGloballyPaused: state.isGloballyPaused })
  }
  return {
    mockGetDownloads: vi.fn(),
    mockCancelDownload: vi.fn(),
    mockGetConfig: vi.fn(),
    mockOpenDownloadDir: vi.fn(),
    mockHandlePauseTask: vi.fn(),
    mockHandleRetryTask: vi.fn(),
    mockStoreState: state
  }
})

vi.mock('@/hooks/useIpc', () => ({
  useDownloadCommands: vi.fn().mockReturnValue({
    getDownloads: mockGetDownloads,
    cancelDownload: mockCancelDownload,
    startDownload: vi.fn(),
    checkDownloadConflict: vi.fn().mockResolvedValue({ hasConflict: false, path: '' }),
    pauseTask: vi.fn(),
    resumeTask: vi.fn(),
    retryTask: vi.fn(),
    toggleGlobalPause: vi.fn(),
    getDownloadDetail: vi.fn(),
  }),
  useDownloadProgress: vi.fn().mockReturnValue({ progress: {} }),
  useDownload: vi.fn().mockReturnValue({
    getDownloads: mockGetDownloads,
    cancelDownload: mockCancelDownload,
    startDownload: vi.fn(),
    checkDownloadConflict: vi.fn().mockResolvedValue({ hasConflict: false, path: '' }),
    progress: {},
  }),
  useConfig: vi.fn().mockReturnValue({
    getConfig: mockGetConfig,
    openDownloadDir: mockOpenDownloadDir,
  }),
  useComicDetail: vi.fn().mockReturnValue({
    getComicDetail: vi.fn().mockResolvedValue({ comic: null })
  }),
  useAlbumCommands: vi.fn().mockReturnValue({
    forcePackAlbum: vi.fn().mockResolvedValue({ status: 'error', errorMessage: 'No coordinator' }),
    getAlbumProgress: vi.fn().mockResolvedValue({ albumId: '', albumTitle: '', albumFolderPath: '', packedPath: null, totalChapters: 0, chaptersOnDisk: 0, chaptersInQueue: 0, isComplete: false }),
  }),
  useAlbumProgress: vi.fn().mockReturnValue({ albumProgress: {} }),
  // 漫画库 hooks mock
  useLibrary: vi.fn().mockReturnValue({
    list: vi.fn().mockResolvedValue({ items: [], pagination: { currentPage: 1, totalPages: 0, totalItems: 0 } }),
    stats: vi.fn().mockResolvedValue(null),
    detail: vi.fn(),
    chapters: vi.fn(),
    cover: vi.fn(),
    pageManifest: vi.fn(),
    getPage: vi.fn(),
    getReadingProgress: vi.fn(),
    saveReadingProgress: vi.fn(),
  }),
  useLibraryScan: vi.fn().mockReturnValue({
    status: vi.fn().mockResolvedValue({ phase: 'idle', scanId: null, isScanning: false, current: 0, total: 0, currentLabel: '', lastScanCompletedAt: null, lastScanCancelled: false, lastScanError: null }),
    start: vi.fn().mockResolvedValue({ scanId: 'test', started: true, alreadyRunning: false }),
    cancel: vi.fn().mockResolvedValue({ cancelled: false, scanId: null }),
  }),
  useLibraryScanProgress: vi.fn().mockReturnValue({ progress: null, clear: vi.fn() }),
}))

vi.mock('@/hooks/useDownloadHelper', () => ({
  useDownloadHelper: vi.fn().mockReturnValue({
    handlePauseTask: mockHandlePauseTask,
    handleResumeTask: vi.fn(),
    handleRetryTask: mockHandleRetryTask,
    handleToggleGlobalPause: vi.fn(),
  }),
  useChapterProbe: vi.fn().mockReturnValue({
    probeChaptersBeforeDownload: vi.fn().mockResolvedValue(null),
  }),
}))

vi.mock('@/stores/useDownloadStore', () => ({
  useDownloadStore: Object.assign(
    vi.fn((selector?: (s: typeof mockStoreState) => unknown) => {
      return selector ? selector(mockStoreState) : mockStoreState
    }),
    { getState: mockStoreState.getState }
  )
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
    mockStoreState.isGloballyPaused = false
    mockGetDownloads.mockResolvedValue({ tasks: [] })
    mockCancelDownload.mockResolvedValue({ success: true })
    mockGetConfig.mockResolvedValue({ config: { downloadDir: '' } })
    mockOpenDownloadDir.mockResolvedValue({ success: true })
  })

  it('renders page content with workspace subtabs', () => {
    render(<DownloadPage />)

    // 工作区应显示子页签，默认漫画库
    expect(screen.getByTestId('workspace-subtabs')).toBeInTheDocument()
    expect(screen.getByText('漫画库')).toBeInTheDocument()
    expect(screen.getByText('下载任务')).toBeInTheDocument()
  })

  it('provides a responsive padded and centered page canvas', () => {
    render(<DownloadPage />)

    expect(screen.getByTestId('download-page-shell')).toHaveClass('px-4', 'sm:px-6', 'min-w-0')
    expect(screen.getByTestId('download-page-content')).toHaveClass('mx-auto', 'w-full', 'max-w-6xl')
  })

  it('shows active download count badge on tasks subtab', () => {
    mockStoreState.tasks = [
      { id: 'task-1', comic: mockComic, status: 'downloading', progress: 50, totalPages: 10, downloadedPages: 5 },
    ]
    render(<DownloadPage />)

    // 活跃任务数显示在子页签徽章中
    expect(screen.getByTestId('subtab-tasks')).toHaveTextContent('1')
  })

  it('shows empty state when no tasks', async () => {
    render(<DownloadPage />)
    // 切换到下载任务子页签
    await userEvent.click(screen.getByTestId('subtab-tasks'))

    expect(screen.getByText('暂无下载任务')).toBeInTheDocument()
    expect(screen.getByTestId('download-empty-state')).toHaveClass('rounded-xl', 'border', 'py-16')
  })

  it('shows download tasks when they exist', async () => {
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
    await userEvent.click(screen.getByTestId('subtab-tasks'))

    expect(screen.getByText('Test Comic')).toBeInTheDocument()
    expect(screen.queryByText('暂无下载任务')).not.toBeInTheDocument()
    expect(screen.getByTestId('download-task-list')).toHaveClass('space-y-4')
  })

  it('shows cancel button for downloading tasks', async () => {
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
    await userEvent.click(screen.getByTestId('subtab-tasks'))

    expect(screen.getByText('取消')).toBeInTheDocument()
  })

  it('does not show cancel button for completed tasks', async () => {
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
    await userEvent.click(screen.getByTestId('subtab-tasks'))

    expect(screen.queryByText('取消')).not.toBeInTheDocument()
  })

  it('shows error message for failed tasks', async () => {
    const tasks: DownloadTask[] = [
      {
        id: 'task-1',
        comic: mockComic,
        status: 'failed',
        progress: 30,
        totalPages: 20,
        downloadedPages: 6,
        error: 'Network timeout'
      }
    ]
    mockStoreState.tasks = tasks

    render(<DownloadPage />)
    await userEvent.click(screen.getByTestId('subtab-tasks'))

    expect(screen.getByText('Network timeout')).toBeInTheDocument()
  })

  // 已删除 'calls getDownloads on mount'（cleanup-test-quality-backlog Phase B）：
  // 原仅断言 mockGetDownloads.toHaveBeenCalled()，是裸 mock 调用断言。mount 触发数据
  // 加载的意图已由同文件"渲染数据/Failed to load"等用例通过真实渲染结果覆盖——
  // 若 getDownloads 不调用，列表不会渲染。无独立信号，删除。

  it('can trigger refresh', async () => {
    render(<DownloadPage />)
    await userEvent.click(screen.getByTestId('subtab-tasks'))

    const refreshButtons = screen.getAllByText('刷新')
    // 任务子页签的刷新按钮
    const refreshButton = refreshButtons[refreshButtons.length - 1]
    await userEvent.click(refreshButton)

    expect(mockGetDownloads).toHaveBeenCalledTimes(2)
  })

  it('hides download directory bar when config has no downloadDir', async () => {
    render(<DownloadPage />)
    await userEvent.click(screen.getByTestId('subtab-tasks'))

    expect(screen.queryByText('打开')).not.toBeInTheDocument()
  })

  it('shows download directory bar and calls openDownloadDir when clicked', async () => {
    mockGetConfig.mockResolvedValue({ config: { downloadDir: 'C:\\Comics' } })

    render(<DownloadPage />)
    await userEvent.click(screen.getByTestId('subtab-tasks'))

    // 等待异步配置加载完成
    const openButton = await screen.findByText('打开')
    const directoryPath = screen.getByText('C:\\Comics')
    expect(directoryPath).toHaveAttribute('title', 'C:\\Comics')
    expect(screen.getByTestId('download-directory-row')).toContainElement(directoryPath)

    await userEvent.click(openButton)
    expect(mockOpenDownloadDir).toHaveBeenCalledWith('C:\\Comics')
  })

  it('filters tasks by status through the responsive action toolbar', async () => {
    mockStoreState.tasks = [
      {
        id: 'completed-task',
        comic: { ...mockComic, id: 'completed', title: 'Completed Comic' },
        status: 'completed',
        progress: 100,
        totalPages: 10,
        downloadedPages: 10,
      },
      {
        id: 'failed-task',
        comic: { ...mockComic, id: 'failed', title: 'Failed Comic' },
        status: 'failed',
        progress: 20,
        totalPages: 10,
        downloadedPages: 2,
      },
    ]

    render(<DownloadPage />)
    await userEvent.click(screen.getByTestId('subtab-tasks'))
    await userEvent.selectOptions(screen.getByRole('combobox'), 'failed')

    expect(screen.getByText('Failed Comic')).toBeInTheDocument()
    expect(screen.queryByText('Completed Comic')).not.toBeInTheDocument()
    expect(screen.getByText('显示 1 / 2 个任务')).toBeInTheDocument()
  })

  it('keeps pause and cancel task actions wired to their original handlers', async () => {
    mockStoreState.tasks = [{
      id: 'task-actions',
      comic: mockComic,
      status: 'downloading',
      progress: 45,
      totalPages: 20,
      downloadedPages: 9,
    }]

    render(<DownloadPage />)
    await userEvent.click(screen.getByTestId('subtab-tasks'))
    await userEvent.click(screen.getByRole('button', { name: '暂停', exact: true }))
    await userEvent.click(screen.getByRole('button', { name: '取消', exact: true }))

    expect(mockHandlePauseTask).toHaveBeenCalledWith('task-actions')
    await waitFor(() => {
      expect(mockCancelDownload).toHaveBeenCalledWith('task-actions')
      expect(mockStoreState.updateTask).toHaveBeenCalledWith('task-actions', { status: 'cancelled' })
    })
  })

  it('keeps failed task retry wired to the original handler', async () => {
    mockStoreState.tasks = [{
      id: 'failed-task',
      comic: mockComic,
      status: 'failed',
      progress: 20,
      totalPages: 10,
      downloadedPages: 2,
    }]

    render(<DownloadPage />)
    await userEvent.click(screen.getByTestId('subtab-tasks'))
    await userEvent.click(screen.getByRole('button', { name: '重试' }))

    expect(mockHandleRetryTask).toHaveBeenCalledWith('failed-task')
  })

  it('keeps album chapters collapsed until the user expands them', async () => {
    mockStoreState.tasks = [
      {
        id: 'chapter-1',
        comic: { ...mockComic, id: 'chapter-1', title: 'Chapter One', albumId: 'album-1', albumTitle: 'Test Album', albumTotalChapters: 2 },
        status: 'completed',
        progress: 100,
        totalPages: 10,
        downloadedPages: 10,
      },
      {
        id: 'chapter-2',
        comic: { ...mockComic, id: 'chapter-2', title: 'Chapter Two', albumId: 'album-1', albumTitle: 'Test Album', albumTotalChapters: 2 },
        status: 'completed',
        progress: 100,
        totalPages: 10,
        downloadedPages: 10,
      },
    ]

    render(<DownloadPage />)
    await userEvent.click(screen.getByTestId('subtab-tasks'))
    expect(screen.queryByText('Chapter One')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '▶ 展开查看 2 章' }))

    expect(screen.getByText('Chapter One')).toBeInTheDocument()
    expect(screen.getByText('Chapter Two')).toBeInTheDocument()
  })
})
