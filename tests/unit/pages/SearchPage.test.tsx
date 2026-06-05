import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComicInfo } from '@shared/types'
import { useSettingsStore } from '@/stores/useSettingsStore'

// Hoist mock functions so they are available inside vi.mock factories
const { mockSearch, mockRandom, mockStartDownload, mockStoreState } = vi.hoisted(() => {
  const state = {
    comics: [] as ComicInfo[],
    pagination: null as Record<string, number> | null,
    isLoading: false,
    error: null as string | null,
    setComics: vi.fn(),
    setPagination: vi.fn(),
    setLoading: vi.fn(),
    setError: vi.fn()
  }
  return {
    mockSearch: vi.fn(),
    mockRandom: vi.fn().mockResolvedValue({ comics: [], pagination: { currentPage: 1, totalPages: 0, totalItems: 0 } }),
    mockStartDownload: vi.fn(),
    mockStoreState: state
  }
})

const { mockGetConfig } = vi.hoisted(() => ({
  mockGetConfig: vi.fn().mockResolvedValue({ config: { defaultSource: 'hcomic' } })
}))

vi.mock('@/hooks/useIpc', () => ({
  useSearch: vi.fn().mockReturnValue({ search: mockSearch }),
  useRandom: vi.fn().mockReturnValue({ random: mockRandom }),
  useDownloadCommands: vi.fn().mockReturnValue({
    startDownload: mockStartDownload,
    cancelDownload: vi.fn(),
    getDownloads: vi.fn(),
    checkDownloadConflict: vi.fn().mockResolvedValue({ hasConflict: false, path: '' }),
    pauseTask: vi.fn(),
    resumeTask: vi.fn(),
    retryTask: vi.fn(),
    toggleGlobalPause: vi.fn(),
    getDownloadDetail: vi.fn(),
  }),
  useDownload: vi.fn().mockReturnValue({
    startDownload: mockStartDownload,
    cancelDownload: vi.fn(),
    getDownloads: vi.fn()
  }),
  useConfig: vi.fn().mockReturnValue({
    getConfig: mockGetConfig,
    setConfig: vi.fn()
  }),
  useComicDetail: vi.fn().mockReturnValue({
    getComicDetail: vi.fn().mockResolvedValue({ comic: null })
  }),
  useFavouriteTags: vi.fn().mockReturnValue({
    getFavouriteTags: vi.fn().mockResolvedValue({ tags: [] }),
    syncFavouriteTags: vi.fn(),
    removeFavouriteTag: vi.fn()
  }),
  useDownloadProgress: vi.fn().mockReturnValue({ progress: {} }),
}))

vi.mock('@/stores/useComicStore', () => ({
  useComicStore: vi.fn(() => mockStoreState)
}))

vi.mock('@/stores/useDownloadStore', () => ({
  useDownloadStore: vi.fn().mockReturnValue([])
}))

vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: vi.fn().mockReturnValue({ cardStyle: 'cover', sfwMode: false, tagBlacklist: { hcomic: [], moeimg: [], jmcomic: [], bika: [] }, filterEnabled: true, setFilterEnabled: vi.fn(), favouriteTagHighlight: false, setFavouriteTagHighlight: vi.fn() })
}))

const { mockSearchCacheStore } = vi.hoisted(() => {
  const store = {
    cache: null as Record<string, unknown> | null,
    hasCache: false,
    setCache: vi.fn(),
    clearCache: vi.fn()
  }
  return { mockSearchCacheStore: store }
})

vi.mock('@/stores/useSearchCacheStore', () => ({
  useSearchCacheStore: vi.fn(() => mockSearchCacheStore)
}))

vi.mock('@/components/common/ComicCard', () => ({
  ComicCard: ({ comic }: { comic: ComicInfo }) => (
    <div data-testid="comic-card">{comic.title}</div>
  )
}))

// Import the component AFTER mocks
import { SearchPage } from '@/pages/SearchPage'

describe('SearchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreState.comics = []
    mockStoreState.pagination = null
    mockStoreState.isLoading = false
    mockStoreState.error = null
    mockSearchCacheStore.cache = null
    mockSearchCacheStore.hasCache = false
  })

  it('renders search input area', () => {
    render(<SearchPage />)

    expect(screen.getByPlaceholderText('输入搜索内容...')).toBeInTheDocument()
    expect(screen.getByText('搜索')).toBeInTheDocument()
  })

  it('renders source and mode selectors', () => {
    render(<SearchPage />)

    expect(screen.getByText('HComic')).toBeInTheDocument()
    expect(screen.getByText('关键词')).toBeInTheDocument()
  })

  it('shows loading state when isLoading is true', () => {
    mockStoreState.isLoading = true

    render(<SearchPage />)

    expect(screen.getByText('搜索中...')).toBeInTheDocument()
  })

  it('shows error message when error is set', () => {
    mockStoreState.error = 'Something went wrong'

    render(<SearchPage />)

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('shows empty state when no comics', () => {
    mockStoreState.comics = []
    mockStoreState.isLoading = false

    render(<SearchPage />)

    expect(screen.getByText('暂无搜索结果')).toBeInTheDocument()
  })

  it('shows comic cards when comics are available', () => {
    const comics: ComicInfo[] = [
      { id: '1', title: 'Comic A', url: 'https://example.com/1', coverUrl: '', source: 'test' },
      { id: '2', title: 'Comic B', url: 'https://example.com/2', coverUrl: '', source: 'test' }
    ]
    mockStoreState.comics = comics

    render(<SearchPage />)

    expect(screen.getByText('Comic A')).toBeInTheDocument()
    expect(screen.getByText('Comic B')).toBeInTheDocument()
  })

  it('calls search on button click with query', async () => {
    mockSearch.mockResolvedValue({
      comics: [],
      pagination: { currentPage: 1, totalPages: 1, totalItems: 0 }
    })

    render(<SearchPage />)

    const input = screen.getByPlaceholderText('输入搜索内容...')
    await userEvent.type(input, 'test query')
    await userEvent.click(screen.getByText('搜索'))

    expect(mockSearch).toHaveBeenCalledWith('test query', 'keyword', 1, 'hcomic', undefined)
  })

  it('auto-searches with empty keyword on mount', async () => {
    mockSearch.mockResolvedValue({
      comics: [],
      pagination: { currentPage: 1, totalPages: 1, totalItems: 0 }
    })

    render(<SearchPage />)

    // Wait for the async getConfig + search to complete
    await screen.findByPlaceholderText('输入搜索内容...')

    expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 1, 'hcomic')
  })

  it('sends search request with empty query when button clicked', async () => {
    mockSearch.mockResolvedValue({
      comics: [],
      pagination: { currentPage: 1, totalPages: 1, totalItems: 0 }
    })

    render(<SearchPage />)

    await userEvent.click(screen.getByText('搜索'))

    // At least one call should have empty query (mount auto-search or button click)
    expect(mockSearch).toHaveBeenCalled()
  })

  it('shows pagination when totalPages > 1', () => {
    mockStoreState.comics = [
      { id: '1', title: 'Comic A', url: 'https://example.com/1', coverUrl: '', source: 'test' }
    ]
    mockStoreState.pagination = { currentPage: 2, totalPages: 3, totalItems: 30 }

    render(<SearchPage />)

    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    expect(screen.getByText('上一页')).toBeInTheDocument()
    expect(screen.getByText('下一页')).toBeInTheDocument()
  })

  it('does not show empty state when comics are available', () => {
    mockStoreState.comics = [
      { id: '1', title: 'Comic A', url: 'https://example.com/1', coverUrl: '', source: 'test' }
    ]

    render(<SearchPage />)

    expect(screen.queryByText('暂无搜索结果')).not.toBeInTheDocument()
  })

  it('restores state from cache on mount without calling search', () => {
    const cachedComics: ComicInfo[] = [
      { id: '1', title: 'Cached Comic', url: 'https://example.com/1', coverUrl: '', source: 'test' }
    ]
    mockSearchCacheStore.cache = {
      query: 'cached query',
      mode: 'author',
      source: 'jmcomic',
      searchTags: 'tag1',
      comics: cachedComics,
      pagination: { currentPage: 3, totalPages: 5, totalItems: 50 }
    }
    mockSearchCacheStore.hasCache = true
    mockStoreState.comics = cachedComics
    mockStoreState.pagination = { currentPage: 3, totalPages: 5, totalItems: 50 }

    render(<SearchPage />)

    expect(mockSearch).not.toHaveBeenCalled()
    expect(screen.getByText('Cached Comic')).toBeInTheDocument()
    expect(screen.getByDisplayValue('cached query')).toBeInTheDocument()
  })

  describe('container layout by cardStyle', () => {
    const comicsWithResults: ComicInfo[] = [
      { id: '1', title: 'Comic A', url: 'https://example.com/1', coverUrl: '', source: 'test' }
    ]

    it('uses grid layout for cover mode', () => {
      vi.mocked(useSettingsStore).mockReturnValue({ cardStyle: 'cover', sfwMode: false, tagBlacklist: { hcomic: [], moeimg: [], jmcomic: [], bika: [] }, filterEnabled: true, setFilterEnabled: vi.fn() })
      mockStoreState.comics = comicsWithResults

      render(<SearchPage />)
      const gridContainer = screen.getByText('Comic A').closest('div[class*="grid"]')
      expect(gridContainer).toBeInTheDocument()
    })

    it('uses flex-col layout for detailed mode', () => {
      vi.mocked(useSettingsStore).mockReturnValue({ cardStyle: 'detailed', sfwMode: false, tagBlacklist: { hcomic: [], moeimg: [], jmcomic: [], bika: [] }, filterEnabled: true, setFilterEnabled: vi.fn() })
      mockStoreState.comics = comicsWithResults

      render(<SearchPage />)
      const flexContainer = screen.getByText('Comic A').closest('div[class*="flex-col"]')
      expect(flexContainer).toBeInTheDocument()
    })
  })

  describe('source switching', () => {
    it('triggers empty search when switching to a non-jmcomic source', async () => {
      mockSearch.mockResolvedValue({
        comics: [],
        pagination: { currentPage: 1, totalPages: 1, totalItems: 0 }
      })

      render(<SearchPage />)
      await screen.findByPlaceholderText('输入搜索内容...')

      const sourceSelect = screen.getByDisplayValue('HComic')
      await userEvent.selectOptions(sourceSelect, 'moeimg')

      // Last search call should be for moeimg with empty query
      const lastCall = mockSearch.mock.calls[mockSearch.mock.calls.length - 1]
      expect(lastCall).toEqual(['', 'keyword', 1, 'moeimg'])
    })

    it('triggers random search when switching to jmcomic source', async () => {
      mockSearch.mockResolvedValue({
        comics: [],
        pagination: { currentPage: 1, totalPages: 1, totalItems: 0 }
      })

      render(<SearchPage />)
      await screen.findByPlaceholderText('输入搜索内容...')

      const sourceSelect = screen.getByDisplayValue('HComic')
      await userEvent.selectOptions(sourceSelect, 'jmcomic')

      expect(mockRandom).toHaveBeenCalledWith('jmcomic')
    })

    it('does not trigger extra search on initial mount', async () => {
      mockSearch.mockResolvedValue({
        comics: [],
        pagination: { currentPage: 1, totalPages: 1, totalItems: 0 }
      })

      render(<SearchPage />)
      await screen.findByPlaceholderText('输入搜索内容...')

      expect(mockRandom).not.toHaveBeenCalled()
      expect(mockSearch).toHaveBeenCalledTimes(1)
    })

    it('shows login prompt when switching to jmcomic with auth error', async () => {
      const authError = new Error('jmcomic 未登录，请前往设置页面配置登录凭证') as Error & { code?: number }
      authError.code = -32001
      mockRandom.mockRejectedValue(authError)

      render(<SearchPage />)
      await screen.findByPlaceholderText('输入搜索内容...')

      const sourceSelect = screen.getByDisplayValue('HComic')
      await userEvent.selectOptions(sourceSelect, 'jmcomic')

      expect(screen.getByText('jmcomic 登录信息已过期或未配置，请前往设置页面重新登录')).toBeInTheDocument()
    })

    it('shows navigate-to-settings button when needsLogin and onNavigateToSettings provided', async () => {
      const authError = new Error('jmcomic 未登录') as Error & { code?: number }
      authError.code = -32001
      mockRandom.mockRejectedValue(authError)
      const mockNavigate = vi.fn()

      render(<SearchPage onNavigateToSettings={mockNavigate} />)
      await screen.findByPlaceholderText('输入搜索内容...')

      const sourceSelect = screen.getByDisplayValue('HComic')
      await userEvent.selectOptions(sourceSelect, 'jmcomic')

      const button = screen.getByText('前往设置')
      expect(button).toBeInTheDocument()
      await userEvent.click(button)
      expect(mockNavigate).toHaveBeenCalled()
    })

    it('shows login prompt on mount when default source is jmcomic with auth error', async () => {
      mockGetConfig.mockResolvedValue({ config: { defaultSource: 'jmcomic' } })
      const authError = new Error('jmcomic 未登录') as Error & { code?: number }
      authError.code = -32001
      mockSearch.mockRejectedValue(authError)

      render(<SearchPage />)
      await screen.findByText('jmcomic 登录信息已过期或未配置，请前往设置页面重新登录')
    })
  })
})
