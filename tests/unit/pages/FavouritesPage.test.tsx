import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
  useAlbumCommands: vi.fn().mockReturnValue({
    forcePackAlbum: vi.fn(),
    getAlbumProgress: vi.fn(),
    pauseAlbum: vi.fn(),
    resumeAlbum: vi.fn(),
    cancelAlbum: vi.fn(),
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

const { mockFavouritesStore } = vi.hoisted(() => ({
  mockFavouritesStore: {
    caches: {} as Record<string, unknown>,
    currentSource: 'hcomic',
    currentPage: 1,
    hasCache: false,
    setPage: vi.fn(),
    getPage: vi.fn(),
    hasPage: vi.fn().mockReturnValue(false),
    clearCache: vi.fn(),
    setCurrentSource: vi.fn(),
  },
}))

vi.mock('@/stores/useFavouritesStore', () => ({
  useFavouritesStore: vi.fn().mockReturnValue(mockFavouritesStore),
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
    mockCheckDownloadedStatus.mockResolvedValue({ statusMap: {} })
    mockFavouritesStore.caches = {}
    mockFavouritesStore.currentSource = 'hcomic'
    mockFavouritesStore.currentPage = 1
    mockFavouritesStore.hasCache = false
    mockFavouritesStore.getPage.mockReset()
    mockFavouritesStore.hasPage.mockReset()
    mockFavouritesStore.hasPage.mockReturnValue(false)
    mockFavouritesStore.setPage.mockReset()
    mockFavouritesStore.clearCache.mockReset()
    mockFavouritesStore.setCurrentSource.mockReset()
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

  it('shows cached favourites page immediately and refreshes it in background', async () => {
    mockFavouritesStore.hasPage.mockReturnValue(true)
    mockGetFavourites.mockResolvedValueOnce({
      comics: [{ id: '1', title: 'Current Favourite', url: 'https://example.com/1', coverUrl: '', source: 'test' }],
      pagination: { currentPage: 1, totalPages: 3, totalItems: 30 },
      needsLogin: false,
    }).mockReturnValueOnce(new Promise(() => {}))
    mockFavouritesStore.getPage.mockImplementation((_source: string, page: number) => {
      if (page !== 2) return undefined
      return {
        comics: [{ id: '2', title: 'Cached Favourite', url: 'https://example.com/2', coverUrl: '', source: 'test' }],
        pagination: { currentPage: 2, totalPages: 3, totalItems: 30 },
        currentPage: 2,
        downloadedStatus: {},
      }
    })

    render(<FavouritesPage />)

    await userEvent.click((await screen.findAllByText('下一页'))[0])

    expect(await screen.findByText('Cached Favourite')).toBeInTheDocument()
    expect(mockGetFavourites).toHaveBeenCalledWith(2, 'hcomic')
  })

  it('preloads nearby favourites pages after current page is loaded', async () => {
    mockGetFavourites.mockResolvedValue({
      comics: [{ id: '5', title: 'Current Favourite', url: 'https://example.com/5', coverUrl: '', source: 'test' }],
      pagination: { currentPage: 5, totalPages: 10, totalItems: 100 },
      needsLogin: false,
    })

    render(<FavouritesPage />)

    await screen.findByText('Current Favourite')
    await waitFor(() => expect(mockGetFavourites).toHaveBeenCalledWith(6, 'hcomic'))
  })
})
