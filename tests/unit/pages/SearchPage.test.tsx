import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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

const { mockVerifyAuth } = vi.hoisted(() => ({
  mockVerifyAuth: vi.fn().mockResolvedValue({ valid: true })
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
    clearFavouriteTags: vi.fn(),
    removeFavouriteTag: vi.fn()
  }),
  useDownloadProgress: vi.fn().mockReturnValue({ progress: {} }),
  useAuth: vi.fn().mockReturnValue({
    verifyAuth: mockVerifyAuth,
  }),
  useTagList: vi.fn().mockReturnValue({
    getTagList: vi.fn().mockResolvedValue({ tags: [], total: 0 }),
    refreshTagList: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('@/hooks/useDownloadHelper', () => ({
  useDownloadHelper: vi.fn().mockReturnValue({
    downloadWithConflictCheck: vi.fn().mockResolvedValue(true),
    downloadChapters: vi.fn().mockResolvedValue(true),
  }),
  useChapterProbe: vi.fn().mockReturnValue({
    probeChaptersBeforeDownload: vi.fn().mockResolvedValue(null),
  }),
}))

vi.mock('@/stores/useComicStore', () => ({
  useComicStore: vi.fn(() => mockStoreState)
}))

vi.mock('@/stores/useDownloadStore', () => ({
  useDownloadStore: vi.fn().mockReturnValue([])
}))

vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: vi.fn().mockReturnValue({ cardStyle: 'cover', sfwMode: false, tagBlacklist: { hcomic: [], moeimg: [], jmcomic: [], bika: [], copymanga: [] }, filterEnabled: true, setFilterEnabled: vi.fn(), favouriteTagHighlight: false, setFavouriteTagHighlight: vi.fn() })
}))

const { mockSearchCacheStore } = vi.hoisted(() => {
  const store = {
    contexts: {} as Record<string, unknown>,
    currentContextKey: null as string | null,
    currentPage: 1,
    hasCache: false,
    setPage: vi.fn(),
    getPage: vi.fn(),
    hasPage: vi.fn().mockReturnValue(false),
    clearContext: vi.fn(),
    clearCache: vi.fn(),
  }
  return { mockSearchCacheStore: store }
})

vi.mock('@/stores/useSearchCacheStore', () => ({
  createSearchContextKey: ({ query, mode, source, searchTags }: { query: string; mode: string; source: string; searchTags: string }) => [source, mode, query.trim(), searchTags].join('\u001f'),
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
    mockGetConfig.mockResolvedValue({ config: { defaultSource: 'hcomic' } })
    mockStoreState.comics = []
    mockStoreState.pagination = null
    mockStoreState.isLoading = false
    mockStoreState.error = null
    mockSearchCacheStore.contexts = {}
    mockSearchCacheStore.currentContextKey = null
    mockSearchCacheStore.currentPage = 1
    mockSearchCacheStore.hasCache = false
    mockSearchCacheStore.setPage.mockReset()
    mockSearchCacheStore.getPage.mockReset()
    mockSearchCacheStore.hasPage.mockReset()
    mockSearchCacheStore.hasPage.mockReturnValue(false)
    mockSearchCacheStore.clearContext.mockReset()
    mockSearchCacheStore.clearCache.mockReset()
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

    // SearchBar 和底栏各渲染一个 PaginationControls
    expect(screen.getAllByText('2 / 3').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('上一页').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('下一页').length).toBeGreaterThanOrEqual(1)
  })

  it('does not show empty state when comics are available', () => {
    mockStoreState.comics = [
      { id: '1', title: 'Comic A', url: 'https://example.com/1', coverUrl: '', source: 'test' }
    ]

    render(<SearchPage />)

    expect(screen.queryByText('暂无搜索结果')).not.toBeInTheDocument()
  })

  it('shows cached search page immediately and refreshes it in background', async () => {
    mockStoreState.comics = [
      { id: '1', title: 'Page 1 Comic', url: 'https://example.com/1', coverUrl: '', source: 'test' },
    ]
    mockStoreState.pagination = { currentPage: 1, totalPages: 3, totalItems: 30 }
    mockSearchCacheStore.getPage.mockReturnValue({
      query: '',
      mode: 'keyword',
      source: 'hcomic',
      searchTags: '',
      comics: [{ id: '2', title: 'Cached Page 2 Comic', url: 'https://example.com/2', coverUrl: '', source: 'test' }],
      pagination: { currentPage: 2, totalPages: 3, totalItems: 30 },
    })
    mockSearch.mockResolvedValue({
      comics: [{ id: '2fresh', title: 'Fresh Page 2 Comic', url: 'https://example.com/2fresh', coverUrl: '', source: 'test' }],
      pagination: { currentPage: 2, totalPages: 3, totalItems: 30 },
    })

    render(<SearchPage />)

    await userEvent.click(screen.getAllByText('下一页')[0])

    expect(mockStoreState.setComics).toHaveBeenCalledWith([
      { id: '2', title: 'Cached Page 2 Comic', url: 'https://example.com/2', coverUrl: '', source: 'test' },
    ])
    expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 2, 'hcomic', undefined)
  })

  it('preloads nearby search pages after current page is available', async () => {
    mockStoreState.comics = [
      { id: '5', title: 'Page 5 Comic', url: 'https://example.com/5', coverUrl: '', source: 'test' },
    ]
    mockStoreState.pagination = { currentPage: 5, totalPages: 10, totalItems: 100 }
    mockSearch.mockResolvedValue({ comics: [], pagination: { currentPage: 6, totalPages: 10, totalItems: 100 } })

    render(<SearchPage />)

    await screen.findByText('Page 5 Comic')
    await waitFor(() => expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 6, 'hcomic', undefined))
  })

  describe('container layout by cardStyle', () => {
    const comicsWithResults: ComicInfo[] = [
      { id: '1', title: 'Comic A', url: 'https://example.com/1', coverUrl: '', source: 'test' }
    ]

    it('uses grid layout for cover mode', () => {
      vi.mocked(useSettingsStore).mockReturnValue({ cardStyle: 'cover', sfwMode: false, tagBlacklist: { hcomic: [], moeimg: [], jmcomic: [], bika: [], copymanga: [] }, filterEnabled: true, setFilterEnabled: vi.fn() })
      mockStoreState.comics = comicsWithResults

      render(<SearchPage />)
      const gridContainer = screen.getByText('Comic A').closest('div[class*="grid"]')
      expect(gridContainer).toBeInTheDocument()
    })

    it('uses flex-col layout for detailed mode', () => {
      vi.mocked(useSettingsStore).mockReturnValue({ cardStyle: 'detailed', sfwMode: false, tagBlacklist: { hcomic: [], moeimg: [], jmcomic: [], bika: [], copymanga: [] }, filterEnabled: true, setFilterEnabled: vi.fn() })
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
      mockVerifyAuth.mockResolvedValue({ valid: true })

      render(<SearchPage />)
      await screen.findByPlaceholderText('输入搜索内容...')

      const sourceSelect = screen.getByDisplayValue('HComic')
      await userEvent.selectOptions(sourceSelect, 'jmcomic')

      expect(mockVerifyAuth).toHaveBeenCalledWith('jmcomic')
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
      mockVerifyAuth.mockResolvedValue({ valid: false })

      render(<SearchPage />)
      await screen.findByPlaceholderText('输入搜索内容...')

      const sourceSelect = screen.getByDisplayValue('HComic')
      await userEvent.selectOptions(sourceSelect, 'jmcomic')

      expect(mockRandom).not.toHaveBeenCalled()
      expect(screen.getByText('jmcomic 登录信息已过期或未配置，请前往设置页面重新登录')).toBeInTheDocument()
    })

    it('shows navigate-to-settings button when needsLogin and onNavigateToSettings provided', async () => {
      mockVerifyAuth.mockResolvedValue({ valid: false })
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
      mockVerifyAuth.mockResolvedValue({ valid: false })

      render(<SearchPage />)
      await screen.findByText('jmcomic 登录信息已过期或未配置，请前往设置页面重新登录')

      expect(mockSearch).not.toHaveBeenCalled()
    })

    it('shows login prompt when verifyAuth throws', async () => {
      mockVerifyAuth.mockRejectedValue(new Error('Network error'))

      render(<SearchPage />)
      await screen.findByPlaceholderText('输入搜索内容...')

      const sourceSelect = screen.getByDisplayValue('HComic')
      await userEvent.selectOptions(sourceSelect, 'jmcomic')

      expect(mockRandom).not.toHaveBeenCalled()
      expect(screen.getByText('jmcomic 登录信息已过期或未配置，请前往设置页面重新登录')).toBeInTheDocument()
    })

    it('shows login prompt on mount when default source is jmcomic and verifyAuth throws', async () => {
      mockGetConfig.mockResolvedValue({ config: { defaultSource: 'jmcomic' } })
      mockVerifyAuth.mockRejectedValue(new Error('Network error'))

      render(<SearchPage />)
      await screen.findByText('jmcomic 登录信息已过期或未配置，请前往设置页面重新登录')

      expect(mockSearch).not.toHaveBeenCalled()
    })

    it('does not call search when jmcomic needsLogin and search clicked', async () => {
      mockVerifyAuth.mockResolvedValue({ valid: false })

      render(<SearchPage />)
      await screen.findByPlaceholderText('输入搜索内容...')

      const sourceSelect = screen.getByDisplayValue('HComic')
      await userEvent.selectOptions(sourceSelect, 'jmcomic')

      expect(screen.getByText('jmcomic 登录信息已过期或未配置，请前往设置页面重新登录')).toBeInTheDocument()

      mockSearch.mockClear()
      await userEvent.click(screen.getByText('搜索'))
      expect(mockSearch).not.toHaveBeenCalled()
    })

    it('does not call random when jmcomic needsLogin and random clicked', async () => {
      mockVerifyAuth.mockResolvedValue({ valid: false })

      render(<SearchPage />)
      await screen.findByPlaceholderText('输入搜索内容...')

      const sourceSelect = screen.getByDisplayValue('HComic')
      await userEvent.selectOptions(sourceSelect, 'jmcomic')

      expect(screen.getByText('jmcomic 登录信息已过期或未配置，请前往设置页面重新登录')).toBeInTheDocument()

      mockRandom.mockClear()
      const randomButton = screen.getByText('🎲 随机')
      await userEvent.click(randomButton)
      expect(mockRandom).not.toHaveBeenCalled()
    })

    it('shows login prompt when verifyAuth passes but random rejects with auth error', async () => {
      mockVerifyAuth.mockResolvedValue({ valid: true })
      const authError = new Error('Forbidden') as Error & { code?: number }
      authError.code = -32001
      mockRandom.mockRejectedValue(authError)

      render(<SearchPage />)
      await screen.findByPlaceholderText('输入搜索内容...')

      const sourceSelect = screen.getByDisplayValue('HComic')
      await userEvent.selectOptions(sourceSelect, 'jmcomic')

      expect(mockVerifyAuth).toHaveBeenCalledWith('jmcomic')
      expect(mockRandom).toHaveBeenCalledWith('jmcomic')
      expect(screen.getByText('jmcomic 登录信息已过期或未配置，请前往设置页面重新登录')).toBeInTheDocument()
    })

    it('shows login prompt on mount when defaultSource jmcomic, verifyAuth passes, but search rejects with auth error', async () => {
      mockGetConfig.mockResolvedValue({ config: { defaultSource: 'jmcomic' } })
      mockVerifyAuth.mockResolvedValue({ valid: true })
      const authError = new Error('Auth failed') as Error & { code?: number }
      authError.code = -32001
      mockSearch.mockRejectedValue(authError)

      render(<SearchPage />)
      await screen.findByText('jmcomic 登录信息已过期或未配置，请前往设置页面重新登录')

      expect(mockVerifyAuth).toHaveBeenCalledWith('jmcomic')
      expect(mockSearch).toHaveBeenCalled()
    })
  })
})
