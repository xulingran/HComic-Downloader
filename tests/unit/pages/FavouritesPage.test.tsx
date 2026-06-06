import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComicInfo } from '@shared/types'

// Hoist mock functions so they are available inside vi.mock factories
const { mockGetFavourites, mockCheckDownloadedStatus } = vi.hoisted(() => ({
  mockGetFavourites: vi.fn(),
  mockCheckDownloadedStatus: vi.fn().mockResolvedValue({ statusMap: {} }),
}))

vi.mock('@/hooks/useIpc', () => ({
  useFavourites: vi.fn().mockReturnValue({
    getFavourites: mockGetFavourites,
    checkDownloadedStatus: mockCheckDownloadedStatus,
  }),
  useDownloadCommands: vi.fn().mockReturnValue({
    startDownload: vi.fn().mockResolvedValue({ taskId: 'test-id' }),
    cancelDownload: vi.fn().mockResolvedValue({ success: true }),
    getDownloads: vi.fn().mockResolvedValue({ tasks: [] }),
    checkDownloadConflict: vi.fn().mockResolvedValue({ hasConflict: false, path: '' }),
    pauseTask: vi.fn(),
    resumeTask: vi.fn(),
    retryTask: vi.fn(),
    toggleGlobalPause: vi.fn(),
    getDownloadDetail: vi.fn(),
  }),
  useDownload: vi.fn().mockReturnValue({
    startDownload: vi.fn().mockResolvedValue({ taskId: 'test-id' }),
    cancelDownload: vi.fn().mockResolvedValue({ success: true }),
    getDownloads: vi.fn().mockResolvedValue({ tasks: [] }),
  }),
  useComicDetail: vi.fn().mockReturnValue({
    getComicDetail: vi.fn().mockResolvedValue({ comic: null })
  }),
  useDownloadProgress: vi.fn().mockReturnValue({ progress: {} }),
}))

vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: vi.fn().mockReturnValue({ cardStyle: 'cover', tagBlacklist: { hcomic: [], moeimg: [], jmcomic: [], bika: [], copymanga: [] }, filterEnabled: true, setFilterEnabled: vi.fn(), addTag: vi.fn(), removeTag: vi.fn() })
}))

vi.mock('@/stores/useDownloadStore', () => ({
  useDownloadStore: vi.fn().mockReturnValue([])
}))

vi.mock('@/stores/useFavouritesStore', () => ({
  useFavouritesStore: vi.fn().mockReturnValue({
    caches: {},
    comics: [],
    pagination: null,
    currentPage: 1,
    downloadedStatus: {},
    hasCache: false,
    setCache: vi.fn(),
    clearCache: vi.fn(),
  }),
}))

vi.mock('@/components/common/ComicCard', () => ({
  ComicCard: ({ comic }: { comic: ComicInfo }) => (
    <div data-testid="comic-card">{comic.title}</div>
  )
}))

// Import the component AFTER mocks
import { FavouritesPage } from '@/pages/FavouritesPage'

describe('FavouritesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetFavourites.mockResolvedValue({ comics: [] })
  })

  it('renders page content with title', async () => {
    render(<FavouritesPage />)

    await screen.findByText('收藏夹')
  })

  it('renders refresh button', async () => {
    render(<FavouritesPage />)

    await screen.findByText('刷新')
  })

  it('shows empty state when no favorites', async () => {
    mockGetFavourites.mockResolvedValue({ comics: [] })

    render(<FavouritesPage />)

    await screen.findByText('暂无收藏')
  })

  it('shows favorite comics when available', async () => {
    const comics: ComicInfo[] = [
      { id: '1', title: 'Fav Comic A', url: 'https://example.com/1', coverUrl: '', source: 'test' },
      { id: '2', title: 'Fav Comic B', url: 'https://example.com/2', coverUrl: '', source: 'test' }
    ]
    mockGetFavourites.mockResolvedValue({ comics })

    render(<FavouritesPage />)

    await screen.findByText('Fav Comic A')
    expect(screen.getByText('Fav Comic B')).toBeInTheDocument()
  })

  it('shows error state when loading fails', async () => {
    mockGetFavourites.mockRejectedValue(new Error('Failed to load'))

    render(<FavouritesPage />)

    await screen.findByText('Failed to load')
  })

  it('calls getFavourites on mount', () => {
    render(<FavouritesPage />)

    expect(mockGetFavourites).toHaveBeenCalled()
  })

  it('can trigger refresh', async () => {
    mockGetFavourites.mockResolvedValue({ comics: [] })

    render(<FavouritesPage />)

    // Wait for initial load to finish
    await screen.findByText('暂无收藏')

    const refreshButton = screen.getByText('刷新')
    await userEvent.click(refreshButton)

    expect(mockGetFavourites).toHaveBeenCalledTimes(2)
  })

  it('shows loading state initially', () => {
    // Make getFavourites hang so isLoading stays true
    mockGetFavourites.mockReturnValue(new Promise(() => {}))

    render(<FavouritesPage />)

    expect(screen.getByText('加载中...')).toBeInTheDocument()
  })
})
