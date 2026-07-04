import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComicInfo, SearchSection } from '@shared/types'
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

const { mockUseFavouriteTags } = vi.hoisted(() => ({
  mockUseFavouriteTags: vi.fn().mockReturnValue({
    getFavouriteTags: vi.fn().mockResolvedValue({ tags: [] }),
    clearFavouriteTags: vi.fn(),
    removeFavouriteTag: vi.fn()
  })
}))

const { mockUseTagList } = vi.hoisted(() => ({
  mockUseTagList: vi.fn().mockReturnValue({
    getTagList: vi.fn().mockResolvedValue({ tags: [], total: 0 }),
    refreshTagList: vi.fn().mockResolvedValue(undefined),
  })
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
  useFavouriteTags: mockUseFavouriteTags,
  useDownloadProgress: vi.fn().mockReturnValue({ progress: {} }),
  useAuth: vi.fn().mockReturnValue({
    verifyAuth: mockVerifyAuth,
  }),
  useJmDomains: () => ({ getJmDomains: vi.fn(), jmDomains: [] }),
  useTagList: mockUseTagList,
  useTagListProgress: vi.fn().mockReturnValue({ progress: null, clear: vi.fn() }),
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
  useSettingsStore: vi.fn().mockReturnValue({
    cardStyle: 'cover',
    sfwMode: false,
    tagBlacklist: { hcomic: [], moeimg: [], jm: [], bika: [], copymanga: [], nh: [] },
    myTags: { hcomic: [], moeimg: [], jm: [], bika: [], copymanga: [], nh: [] },
    filterEnabled: true,
    setFilterEnabled: vi.fn(),
    favouriteTagHighlight: false,
    favouriteTagMinMatches: 1,
    setFavouriteTagHighlight: vi.fn(),
  })
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

// ComicCard mock: 透传 isRecommended / recommendedTags 到 data-* 属性，
// 便于断言 SearchPage 的高亮编排逻辑，同时保持 comic.title 文本供现有测试使用。
vi.mock('@/components/common/ComicCard', () => ({
  ComicCard: ({ comic, isRecommended, recommendedTags }: {
    comic: ComicInfo
    isRecommended?: boolean
    recommendedTags?: Set<string>
  }) => (
    <div
      data-testid="comic-card"
      data-comic-id={comic.id}
      data-recommended={isRecommended ? 'true' : 'false'}
      data-rec-tags={recommendedTags ? Array.from(recommendedTags).join(',') : ''}
    >
      {comic.title}
    </div>
  )
}))

// Import the component AFTER mocks
import { SearchPage } from '@/pages/SearchPage'

interface SearchResult {
  comics: ComicInfo[]
  pagination?: { currentPage: number; totalPages: number; totalItems: number }
  sections?: SearchSection[]
}

// 控制某次 search 的返回时机，用于模拟迟到完成的预加载请求
function createDeferredSearch() {
  let resolve!: (value: SearchResult) => void
  const promise = new Promise<SearchResult>((res) => { resolve = res })
  return { promise, resolve }
}

describe('SearchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearch.mockResolvedValue({ comics: [], pagination: { currentPage: 1, totalPages: 1, totalItems: 0 } })
    mockRandom.mockResolvedValue({ comics: [], pagination: { currentPage: 1, totalPages: 1, totalItems: 0 } })
    mockVerifyAuth.mockResolvedValue({ valid: true })
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
    mockUseTagList.mockReturnValue({
      getTagList: vi.fn().mockResolvedValue({ tags: [], total: 0 }),
      refreshTagList: vi.fn().mockResolvedValue(undefined),
    })
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

    expect(mockSearch).toHaveBeenCalledWith('test query', 'keyword', 1, 'hcomic', undefined, true)
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

    // 清除 mount 自动搜索的调用记录，隔离按钮点击行为
    await screen.findByPlaceholderText('输入搜索内容...')
    mockSearch.mockClear()

    await userEvent.click(screen.getByText('搜索'))

    // 验证按钮点击确实发起了空 query 搜索（而非仅 mount 残留的调用）
    expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 1, 'hcomic', undefined, true)
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

  it('restores and renders cached JM home results by section', async () => {
    const first: ComicInfo = {
      id: '1', title: 'Comic A', url: 'https://example.com/1', coverUrl: '', source: 'JM', sourceSite: 'jm',
    }
    const second: ComicInfo = {
      id: '2', title: 'Comic B', url: 'https://example.com/2', coverUrl: '', source: 'JM', sourceSite: 'jm',
    }
    mockStoreState.comics = [first, second]
    mockStoreState.pagination = { currentPage: 1, totalPages: 1, totalItems: 2 }
    mockSearchCacheStore.currentContextKey = 'jm\u001fkeyword\u001f\u001f'
    mockSearchCacheStore.getPage.mockReturnValue({
      query: '',
      mode: 'keyword',
      source: 'jm',
      searchTags: '',
      comics: [first, second],
      pagination: { currentPage: 1, totalPages: 1, totalItems: 2 },
      sections: [
        { title: '连载更新', comicIds: ['1', '2'] },
        { title: '最新漫画', comicIds: ['1'] },
      ],
    })

    render(<SearchPage />)

    expect(await screen.findByRole('heading', { name: '连载更新' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '最新漫画' })).toBeInTheDocument()
    expect(screen.getAllByText('Comic A')).toHaveLength(2)
    expect(screen.getByText('Comic B')).toBeInTheDocument()
    expect(screen.queryByText('下一页')).not.toBeInTheDocument()
  })

  it('shows NH entry page and opens popular ranking', async () => {
    const user = userEvent.setup()
    mockGetConfig.mockResolvedValue({ config: { defaultSource: 'nh' } })
    mockSearch.mockResolvedValue({
      comics: [],
      pagination: { currentPage: 1, totalPages: 1, totalItems: 0 }
    })

    render(<SearchPage />)

    expect(await screen.findByText('最近更新')).toBeInTheDocument()
    expect(screen.getByText('热门排行')).toBeInTheDocument()

    await user.click(screen.getByText('热门排行'))

    await waitFor(() => {
      expect(mockSearch).toHaveBeenCalledWith('popular-today', 'ranking', 1, 'nh')
    })
  })

  it('clicks NH entry hot tag as tag search', async () => {
    const user = userEvent.setup()
    const getTagList = vi.fn().mockResolvedValue({ tags: [{ tag: 'big breasts', count: 224619 }], total: 1 })
    mockUseTagList.mockReturnValue({
      getTagList,
      refreshTagList: vi.fn().mockResolvedValue(undefined),
    })
    mockGetConfig.mockResolvedValue({ config: { defaultSource: 'nh' } })
    mockSearch.mockResolvedValue({
      comics: [],
      pagination: { currentPage: 1, totalPages: 1, totalItems: 0 }
    })

    render(<SearchPage />)

    await user.click(await screen.findByText('big breasts'))

    await waitFor(() => {
      expect(mockSearch).toHaveBeenCalledWith('big breasts', 'tag', 1, 'nh')
    })
  })

  it('opens tag dialog for NH and requests sorted tags', async () => {
    const user = userEvent.setup()
    const getTagList = vi.fn().mockResolvedValue({ tags: [{ tag: 'big breasts', count: 224619 }], total: 1 })
    mockUseTagList.mockReturnValue({
      getTagList,
      refreshTagList: vi.fn().mockResolvedValue(undefined),
    })
    mockGetConfig.mockResolvedValue({ config: { defaultSource: 'nh' } })
    mockSearch.mockResolvedValue({
      comics: [],
      pagination: { currentPage: 1, totalPages: 1, totalItems: 0 }
    })

    render(<SearchPage />)

    await user.click(await screen.findByText('标签'))
    await waitFor(() => expect(screen.getAllByText('big breasts').length).toBeGreaterThanOrEqual(2))
    await user.click(screen.getByText('A-Z'))

    await waitFor(() => {
      expect(getTagList).toHaveBeenCalledWith('nh', undefined, undefined, undefined, 'name')
    })
  })

  it('selects a tag from NH latest results using tag mode and clears it without restoring ranking', async () => {
    const user = userEvent.setup()
    const getTagList = vi.fn().mockResolvedValue({ tags: [{ tag: 'big breasts', count: 224619 }], total: 1 })
    mockUseTagList.mockReturnValue({
      getTagList,
      refreshTagList: vi.fn().mockResolvedValue(undefined),
    })
    mockGetConfig.mockResolvedValue({ config: { defaultSource: 'nh' } })
    mockSearch.mockResolvedValue({
      comics: [],
      pagination: { currentPage: 1, totalPages: 1, totalItems: 0 },
    })

    render(<SearchPage />)
    await user.click(await screen.findByText('最近更新'))
    await waitFor(() => expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 1, 'nh'))

    mockSearch.mockClear()
    await user.click(screen.getByText('标签'))
    await user.click(await screen.findByText('big breasts'))

    await waitFor(() => {
      expect(mockSearch).toHaveBeenCalledWith('', 'tag', 1, 'nh', 'big breasts', true)
    })

    await user.click(screen.getByText('清除全部'))
    await waitFor(() => {
      // 清除全部标签是用户主动操作，与 handleToggleTag 一致透传 allowInteractiveChallenge=true
      expect(mockSearch).toHaveBeenLastCalledWith('', 'tag', 1, 'nh', undefined, true)
    })
  })

  it('selects a tag from NH popular results instead of continuing the ranking request', async () => {
    const user = userEvent.setup()
    const getTagList = vi.fn().mockResolvedValue({ tags: [{ tag: 'full color', count: 100 }], total: 1 })
    mockUseTagList.mockReturnValue({
      getTagList,
      refreshTagList: vi.fn().mockResolvedValue(undefined),
    })
    mockGetConfig.mockResolvedValue({ config: { defaultSource: 'nh' } })
    mockSearch.mockResolvedValue({
      comics: [],
      pagination: { currentPage: 1, totalPages: 1, totalItems: 0 },
    })

    render(<SearchPage />)
    await user.click(await screen.findByText('热门排行'))
    await waitFor(() => expect(mockSearch).toHaveBeenCalledWith('popular-today', 'ranking', 1, 'nh'))

    mockSearch.mockClear()
    await user.click(screen.getByText('标签'))
    await user.click(await screen.findByText('full color'))

    await waitFor(() => {
      expect(mockSearch).toHaveBeenCalledWith('', 'tag', 1, 'nh', 'full color', true)
    })
    expect(mockSearch).not.toHaveBeenCalledWith('popular-today', 'ranking', 1, 'nh', 'full color')
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
    expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 2, 'hcomic', undefined, false)
  })

  it('restores viewingCategory from cached bika category context on remount', async () => {
    // 复现：用户在 bika 分类搜索结果页切到其他页面再切回时，
    // SearchPage 重新挂载，但 viewingCategory 是局部 state 会丢失。
    // 修复后应从缓存的 mode='category' source='bika' 推导恢复，返回分类按钮重新出现。
    mockStoreState.comics = [
      { id: '1', title: 'Purity Comic', url: 'https://example.com/1', coverUrl: '', source: 'bika' },
    ]
    mockStoreState.pagination = { currentPage: 1, totalPages: 2, totalItems: 20 }
    mockSearchCacheStore.currentContextKey = 'bika\u001fcategory\u001f纯爱\u001f'
    mockSearchCacheStore.currentPage = 1
    mockSearchCacheStore.getPage.mockReturnValue({
      query: '纯爱',
      mode: 'category',
      source: 'bika',
      searchTags: '',
      comics: [{ id: '1', title: 'Purity Comic', url: 'https://example.com/1', coverUrl: '', source: 'bika' }],
      pagination: { currentPage: 1, totalPages: 2, totalItems: 20 },
    })

    render(<SearchPage />)

    expect(await screen.findByText('返回分类')).toBeInTheDocument()
  })

  it('preloads nearby search pages after current page is available', async () => {
    mockStoreState.comics = [
      { id: '5', title: 'Page 5 Comic', url: 'https://example.com/5', coverUrl: '', source: 'test' },
    ]
    mockStoreState.pagination = { currentPage: 5, totalPages: 10, totalItems: 100 }
    mockSearch.mockResolvedValue({ comics: [], pagination: { currentPage: 6, totalPages: 10, totalItems: 100 } })

    render(<SearchPage />)

    await screen.findByText('Page 5 Comic')
    await waitFor(() => expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 6, 'hcomic', undefined, false))
  })

  it('does not commit stale preload results after switching source', async () => {
    // 回归：来源 A 的相邻页预加载请求在切换到来源 B 后才返回时，必须被丢弃，
    // 既不写入 preloadedPagesRef，也不经 commitPage 提交到 search 缓存（setPage）。
    mockStoreState.comics = [
      { id: '1', title: 'Page 1 Comic', url: 'https://example.com/1', coverUrl: '', source: 'test' },
    ]
    mockStoreState.pagination = { currentPage: 1, totalPages: 3, totalItems: 30 }

    // 用「来源 + 页码」键控 search mock：
    // - 来源 hcomic 第 1 页（首屏）立即返回
    // - 来源 hcomic 第 2 页（预加载）挂起，模拟网络往返迟到
    // - 来源 moeimg 任意页立即返回空（切换后首屏）
    const deferredPage2 = createDeferredSearch()
    mockSearch.mockImplementation((_query: string, _mode: string, page: number, source?: string, _tag?: string, _allowInteractive?: boolean) => {
      if (source === 'hcomic' && page === 2) return deferredPage2.promise
      if (source === 'hcomic') {
        return Promise.resolve({
          comics: [{ id: '1', title: 'Page 1 Comic', url: '', coverUrl: '', source: 'test' }],
          pagination: { currentPage: 1, totalPages: 3, totalItems: 30 },
        })
      }
      return Promise.resolve({ comics: [], pagination: { currentPage: 1, totalPages: 1, totalItems: 0 } })
    })

    render(<SearchPage />)
    await screen.findByText('Page 1 Comic')
    // 等到来源 hcomic 的第 2 页预加载请求已发出（仍挂起）
    await waitFor(() => expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 2, 'hcomic', undefined, false))

    // 切换到来源 moeimg——contextKey 变化，旧来源预加载被中断
    const sourceSelect = screen.getByDisplayValue('HComic')
    await userEvent.selectOptions(sourceSelect, 'moeimg')

    // 让来源 hcomic 的迟到预加载请求返回
    deferredPage2.resolve({
      comics: [{ id: '2', title: 'Stale HComic Page 2', url: '', coverUrl: '', source: 'test' }],
      pagination: { currentPage: 2, totalPages: 3, totalItems: 30 },
    })
    await act(async () => { await deferredPage2.promise })

    // 断言：迟到结果未提交到 search 缓存——来源 hcomic 的第 2 页永不出现在 setPage 调用里
    // （hcomic 第 1 页首屏提交是正常的，必须区分页号精确断言）
    const hcomicContextKey = ['hcomic', 'keyword', '', ''].join('\u001f')
    const committedPage2ForHcomic = mockSearchCacheStore.setPage.mock.calls.filter(
      ([contextKey, page]) => contextKey === hcomicContextKey && page === 2,
    )
    expect(committedPage2ForHcomic).toHaveLength(0)
  })

  describe('container layout by cardStyle', () => {
    const comicsWithResults: ComicInfo[] = [
      { id: '1', title: 'Comic A', url: 'https://example.com/1', coverUrl: '', source: 'test' }
    ]

    it('uses grid layout for cover mode', () => {
      vi.mocked(useSettingsStore).mockReturnValue({ cardStyle: 'cover', sfwMode: false, tagBlacklist: { hcomic: [], moeimg: [], jm: [], bika: [], copymanga: [], nh: [] }, filterEnabled: true, setFilterEnabled: vi.fn() })
      mockStoreState.comics = comicsWithResults

      render(<SearchPage />)
      const gridContainer = screen.getByText('Comic A').closest('div[class*="grid"]')
      expect(gridContainer).toBeInTheDocument()
    })

    it('uses flex-col layout for detailed mode', () => {
      vi.mocked(useSettingsStore).mockReturnValue({ cardStyle: 'detailed', sfwMode: false, tagBlacklist: { hcomic: [], moeimg: [], jm: [], bika: [], copymanga: [], nh: [] }, filterEnabled: true, setFilterEnabled: vi.fn() })
      mockStoreState.comics = comicsWithResults

      render(<SearchPage />)
      const flexContainer = screen.getByText('Comic A').closest('div[class*="flex-col"]')
      expect(flexContainer).toBeInTheDocument()
    })
  })

  describe('source switching', () => {
    it('triggers empty search when switching to a non-jm source', async () => {
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

    it('triggers interactive empty keyword search when switching to jm source', async () => {
      mockSearch.mockResolvedValue({
        comics: [],
        pagination: { currentPage: 1, totalPages: 1, totalItems: 0 }
      })
      mockVerifyAuth.mockResolvedValue({ valid: true })

      render(<SearchPage />)
      await screen.findByPlaceholderText('输入搜索内容...')

      const sourceSelect = screen.getByDisplayValue('HComic')
      await userEvent.selectOptions(sourceSelect, 'jm')

      expect(mockVerifyAuth).toHaveBeenCalledWith('jm')
      expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 1, 'jm', undefined, true)
      expect(mockRandom).not.toHaveBeenCalled()
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

    it('shows login prompt when switching to jm with auth error', async () => {
      mockVerifyAuth.mockResolvedValue({ valid: false })

      render(<SearchPage />)
      await screen.findByPlaceholderText('输入搜索内容...')

      const sourceSelect = screen.getByDisplayValue('HComic')
      await userEvent.selectOptions(sourceSelect, 'jm')

      expect(mockRandom).not.toHaveBeenCalled()
      expect(screen.getByText('JM 登录信息已过期或未配置，请前往设置页面重新登录')).toBeInTheDocument()
    })

    it('shows navigate-to-settings button when needsLogin and onNavigateToSettings provided', async () => {
      mockVerifyAuth.mockResolvedValue({ valid: false })
      const mockNavigate = vi.fn()

      render(<SearchPage onNavigateToSettings={mockNavigate} />)
      await screen.findByPlaceholderText('输入搜索内容...')

      const sourceSelect = screen.getByDisplayValue('HComic')
      await userEvent.selectOptions(sourceSelect, 'jm')

      const button = screen.getByText('前往设置')
      expect(button).toBeInTheDocument()
      await userEvent.click(button)
      expect(mockNavigate).toHaveBeenCalled()
    })

    it('shows login prompt on mount when default source is jm with auth error', async () => {
      mockGetConfig.mockResolvedValue({ config: { defaultSource: 'jm' } })
      mockVerifyAuth.mockResolvedValue({ valid: false })

      render(<SearchPage />)
      await screen.findByText('JM 登录信息已过期或未配置，请前往设置页面重新登录')

      expect(mockSearch).not.toHaveBeenCalled()
    })

    it('caches JM home sections loaded from the default source on mount', async () => {
      const comic: ComicInfo = {
        id: '1', title: 'Comic A', url: 'https://example.com/1', coverUrl: '', source: 'JM', sourceSite: 'jm',
      }
      mockGetConfig.mockResolvedValue({ config: { defaultSource: 'jm' } })
      mockSearch.mockResolvedValue({
        comics: [comic],
        pagination: { currentPage: 1, totalPages: 1, totalItems: 1 },
        sections: [{ title: '最新漫画', comicIds: ['1'] }],
      })

      render(<SearchPage />)

      await waitFor(() => expect(mockSearchCacheStore.setPage).toHaveBeenCalledWith(
        'jm\u001fkeyword\u001f\u001f',
        1,
        expect.objectContaining({
          source: 'jm',
          sections: [{ title: '最新漫画', comicIds: ['1'] }],
        }),
        true,
      ))
    })

    it('does NOT show login prompt when JM verifyAuth fails due to challenge (放行让搜索处理)', async () => {
      // 回归：verify_login_status 遇 Cloudflare 挑战返回 {valid:false, message:"...人机验证..."}。
      // 此时不能判定 Cookie 失效——收藏夹此时仍可经挑战恢复获取数据，
      // 搜索也应放行让挑战恢复机制处理，而非误显示"登录信息已过期"。
      mockGetConfig.mockResolvedValue({ config: { defaultSource: 'jm' } })
      mockVerifyAuth.mockResolvedValue({
        valid: false,
        message: '登录校验被站点人机验证阻断，请稍后重试或检查网络与域名设置',
      })
      mockSearch.mockResolvedValue({ comics: [], pagination: { currentPage: 1, totalPages: 1, totalItems: 0 } })

      render(<SearchPage />)
      await screen.findByPlaceholderText('输入搜索内容...')

      // 挑战阻断 verifyAuth 时不显示 needsLogin
      expect(screen.queryByText('JM 登录信息已过期或未配置，请前往设置页面重新登录')).not.toBeInTheDocument()
      // 而是放行继续搜索（让搜索的挑战恢复机制处理）
      expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 1, 'jm')
    })

    it('shows login prompt when verifyAuth throws', async () => {
      mockVerifyAuth.mockRejectedValue(new Error('Network error'))

      render(<SearchPage />)
      await screen.findByPlaceholderText('输入搜索内容...')

      const sourceSelect = screen.getByDisplayValue('HComic')
      await userEvent.selectOptions(sourceSelect, 'jm')

      expect(mockRandom).not.toHaveBeenCalled()
      expect(screen.getByText('JM 登录信息已过期或未配置，请前往设置页面重新登录')).toBeInTheDocument()
    })

    it('shows login prompt on mount when default source is jm and verifyAuth throws', async () => {
      mockGetConfig.mockResolvedValue({ config: { defaultSource: 'jm' } })
      mockVerifyAuth.mockRejectedValue(new Error('Network error'))

      render(<SearchPage />)
      await screen.findByText('JM 登录信息已过期或未配置，请前往设置页面重新登录')

      expect(mockSearch).not.toHaveBeenCalled()
    })

    it('does not call search when jm needsLogin and search clicked', async () => {
      mockVerifyAuth.mockResolvedValue({ valid: false })

      render(<SearchPage />)
      await screen.findByPlaceholderText('输入搜索内容...')

      const sourceSelect = screen.getByDisplayValue('HComic')
      await userEvent.selectOptions(sourceSelect, 'jm')

      expect(screen.getByText('JM 登录信息已过期或未配置，请前往设置页面重新登录')).toBeInTheDocument()

      mockSearch.mockClear()
      await userEvent.click(screen.getByText('搜索'))
      expect(mockSearch).not.toHaveBeenCalled()
    })

    it('does not call random when jm needsLogin and random clicked', async () => {
      mockVerifyAuth.mockResolvedValue({ valid: false })

      render(<SearchPage />)
      await screen.findByPlaceholderText('输入搜索内容...')

      const sourceSelect = screen.getByDisplayValue('HComic')
      await userEvent.selectOptions(sourceSelect, 'jm')

      expect(screen.getByText('JM 登录信息已过期或未配置，请前往设置页面重新登录')).toBeInTheDocument()

      mockRandom.mockClear()
      const randomButton = screen.getByText('🎲 随机')
      await userEvent.click(randomButton)
      expect(mockRandom).not.toHaveBeenCalled()
    })

    it('shows login prompt when verifyAuth passes but JM home search rejects with auth error', async () => {
      mockVerifyAuth.mockResolvedValue({ valid: true })
      const authError = new Error('Forbidden') as Error & { code?: number }
      authError.code = -32001
      mockSearch.mockRejectedValue(authError)

      render(<SearchPage />)
      await screen.findByPlaceholderText('输入搜索内容...')

      const sourceSelect = screen.getByDisplayValue('HComic')
      await userEvent.selectOptions(sourceSelect, 'jm')

      expect(mockVerifyAuth).toHaveBeenCalledWith('jm')
      expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 1, 'jm', undefined, true)
      expect(screen.getByText('JM 登录信息已过期或未配置，请前往设置页面重新登录')).toBeInTheDocument()
    })

    it('keeps the explicit JM random button behavior', async () => {
      render(<SearchPage />)
      await screen.findByPlaceholderText('输入搜索内容...')

      await userEvent.selectOptions(screen.getByDisplayValue('HComic'), 'jm')
      await waitFor(() => expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 1, 'jm', undefined, true))
      mockRandom.mockClear()
      mockSearchCacheStore.setPage.mockClear()

      await userEvent.click(screen.getByText('🎲 随机'))

      expect(mockRandom).toHaveBeenCalledWith('jm')
      expect(mockSearchCacheStore.setPage).not.toHaveBeenCalled()
    })

    it('shows login prompt on mount when defaultSource jm, verifyAuth passes, but search rejects with auth error', async () => {
      mockGetConfig.mockResolvedValue({ config: { defaultSource: 'jm' } })
      mockVerifyAuth.mockResolvedValue({ valid: true })
      const authError = new Error('Auth failed') as Error & { code?: number }
      authError.code = -32001
      mockSearch.mockRejectedValue(authError)

      render(<SearchPage />)
      await screen.findByText('JM 登录信息已过期或未配置，请前往设置页面重新登录')

      expect(mockVerifyAuth).toHaveBeenCalledWith('jm')
      // 重写：裸 toHaveBeenCalled() 改为带 source 参数，验证确实对 jm 发起了搜索
      expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 1, 'jm')
    })
  })

  // 加载遮罩分级：翻页用 light 档（旧结果可读），换来源/新查询用 strong 档（几乎不可辨认）。
  // 文案统一「加载中...」，仅靠 backdrop-blur 像素值与 bg 不透明度区分。
  describe('加载遮罩分级（light / strong）', () => {
    const comicsWithResults: ComicInfo[] = [
      { id: '1', title: 'Comic A', url: 'https://example.com/1', coverUrl: '', source: 'test' }
    ]

    // 取遮罩容器（含 backdrop-blur class 的 div）。遮罩文案为「加载中」，需排除按钮「搜索中...」。
    const getOverlay = () => {
      const overlays = document.querySelectorAll('div.absolute.inset-0')
      return Array.from(overlays).find(el => el.textContent?.includes('加载中')) ?? null
    }

    beforeEach(() => {
      // 让组件内调用的 setLoading 真实更新 mockStoreState.isLoading，使按钮 disabled 逻辑
      // 与遮罩渲染条件（isLoading && overlayIntensity）能反映真实 loading 态。
      mockStoreState.setLoading = vi.fn((loading: boolean) => { mockStoreState.isLoading = loading })
    })

    it('翻页（keepExisting=true）时遮罩为 light 档：backdrop-blur-[2px] + bg/40', async () => {
      // 挂载首屏返回带 sections 的结果，使挂载 effect 设置 loadedContextKeyRef
      // （挂载 effect 仅在有 sections 时设此 ref；非 sections 源首次翻页会被判为新查询）。
      // 随后翻页 isPaging=true → keepExisting=true → light。
      const deferred = createDeferredSearch()
      mockSearch.mockImplementation((_q: string, _m: string, page: number, _s?: string) =>
        page === 2
          ? deferred.promise
          : Promise.resolve({
            comics: comicsWithResults,
            pagination: { currentPage: 1, totalPages: 3, totalItems: 30 },
            sections: [{ title: '最新漫画', comicIds: ['1'] }],
          })
      )
      mockStoreState.comics = comicsWithResults
      mockStoreState.pagination = { currentPage: 1, totalPages: 3, totalItems: 30 }

      render(<SearchPage />)
      // 等首屏完成（loadedContextKeyRef 在 sections 路径下被设置）
      await waitFor(() => expect(mockStoreState.isLoading).toBe(false))

      // 点下一页 → handleSearch → isPaging=true → keepExisting=true → light
      await userEvent.click(screen.getAllByText('下一页')[0])

      const overlay = getOverlay()
      expect(overlay).not.toBeNull()
      expect(overlay?.className).toContain('backdrop-blur-[2px]')
      expect(overlay?.className).toContain('bg-[var(--bg-primary)]/40')
      expect(overlay?.className).not.toContain('backdrop-blur-[10px]')
      expect(overlay?.textContent).toContain('加载中')

      deferred.resolve({ comics: [], pagination: { currentPage: 2, totalPages: 3, totalItems: 30 } })
      await act(async () => { await deferred.promise.catch(() => {}) })
    })

    it('换来源认证窗口遮罩为 strong 档：backdrop-blur-[10px] + bg/85', async () => {
      mockStoreState.comics = comicsWithResults
      mockStoreState.pagination = { currentPage: 1, totalPages: 1, totalItems: 1 }
      // verifyAuth 挂起，使认证校验窗口可观测
      let resolveAuth!: (v: { valid: boolean }) => void
      const authPromise = new Promise<{ valid: boolean }>((res) => { resolveAuth = res })
      mockVerifyAuth.mockImplementation(() => authPromise)

      render(<SearchPage />)
      await screen.findByText('Comic A')

      // 切换到 jm（requiresAuth=true）进入认证校验窗口 → strong
      await userEvent.selectOptions(screen.getByDisplayValue('HComic'), 'jm')

      const overlay = getOverlay()
      expect(overlay).not.toBeNull()
      expect(overlay?.className).toContain('backdrop-blur-[10px]')
      expect(overlay?.className).toContain('bg-[var(--bg-primary)]/85')
      expect(overlay?.className).not.toContain('backdrop-blur-[2px]')

      resolveAuth({ valid: true })
      await act(async () => { await authPromise.catch(() => {}) })
    })

    it('认证校验失败转登录态时遮罩消失、强度不残留', async () => {
      mockStoreState.comics = comicsWithResults
      mockStoreState.pagination = { currentPage: 1, totalPages: 1, totalItems: 1 }
      mockVerifyAuth.mockResolvedValue({ valid: false })

      render(<SearchPage />)
      await screen.findByText('Comic A')

      await userEvent.selectOptions(screen.getByDisplayValue('HComic'), 'jm')

      // 认证失败 → needsLogin，loading 结束，遮罩消失
      await screen.findByText('JM 登录信息已过期或未配置，请前往设置页面重新登录')
      expect(getOverlay()).toBeNull()
    })

    it('同来源新搜索（随机）遮罩为 strong 档', async () => {
      mockStoreState.comics = comicsWithResults
      mockStoreState.pagination = { currentPage: 1, totalPages: 1, totalItems: 1 }
      // random 挂起使 loading 可观测
      const deferredRandom = createDeferredSearch()
      mockRandom.mockImplementation(() => deferredRandom.promise as Promise<SearchResult>)

      render(<SearchPage />)
      await screen.findByText('Comic A')

      // 点击随机按钮 → withLoading(无 keepExisting) → strong
      await userEvent.click(screen.getByText('🎲 随机'))

      const overlay = getOverlay()
      expect(overlay).not.toBeNull()
      expect(overlay?.className).toContain('backdrop-blur-[10px]')
      expect(overlay?.className).toContain('bg-[var(--bg-primary)]/85')

      deferredRandom.resolve({ comics: [], pagination: { currentPage: 1, totalPages: 1, totalItems: 0 } })
      await act(async () => { await deferredRandom.promise.catch(() => {}) })
    })
  })

  // 回归：封面从左上角飞入 bug 修复。
  // 根因：AnimatedCardWrapper 的 layout + AnimatePresence popLayout 在翻页/新搜索整页全量替换时，
  // 新卡片 mount 测量竞态导致 transform 飞入。修复：grid 容器 key 由「搜索上下文 + 页码」派生，
  // 全量替换时整页重挂载，规避 layout 测量竞态。
  // 通过 data-grid-key 断言：全量替换时 key 变化；非全量 re-render 时 key 稳定。
  describe('卡片列表整页重挂载 key（防 layout 飞入）', () => {
    const comicsWithResults: ComicInfo[] = [
      { id: '1', title: 'Comic A', url: 'https://example.com/1', coverUrl: '', source: 'test' }
    ]

    const getGridKey = () => {
      // AnimatePresence popLayout 在 exit 动画期间会同时保留新旧 grid 容器，
      // 故用 getAllByText 取最后（最新挂载）的一个。
      const grids = screen.getAllByText('Comic A').map(el => el.closest('[data-grid-key]'))
      const last = grids[grids.length - 1]
      return last?.getAttribute('data-grid-key') ?? null
    }

    it('翻页（currentPage 变化）时 grid key 改变', () => {
      mockStoreState.comics = comicsWithResults
      mockStoreState.pagination = { currentPage: 1, totalPages: 3, totalItems: 30 }

      const { rerender } = render(<SearchPage />)
      const keyPage1 = getGridKey()

      // 翻到第 2 页（同一批内容上下文，仅页码变化）
      mockStoreState.pagination = { currentPage: 2, totalPages: 3, totalItems: 30 }
      rerender(<SearchPage />)
      const keyPage2 = getGridKey()

      expect(keyPage1).not.toBeNull()
      expect(keyPage2).not.toBeNull()
      expect(keyPage1).not.toBe(keyPage2)
    })

    it('新搜索（query 变化）时 grid key 改变', async () => {
      mockStoreState.comics = comicsWithResults
      mockStoreState.pagination = { currentPage: 1, totalPages: 1, totalItems: 1 }

      const { rerender } = render(<SearchPage />)
      const keyBefore = getGridKey()

      // 输入新 query 触发 searchContextKey 变化（仅验证 key 派生，不实际搜索）
      const input = screen.getByPlaceholderText('输入搜索内容...')
      await userEvent.type(input, 'newquery')

      rerender(<SearchPage />)
      const keyAfter = getGridKey()

      expect(keyBefore).not.toBe(keyAfter)
    })

    it('换来源（source 变化）时 grid key 改变', async () => {
      mockStoreState.comics = comicsWithResults
      mockStoreState.pagination = { currentPage: 1, totalPages: 1, totalItems: 1 }

      const { rerender } = render(<SearchPage />)
      const keyBefore = getGridKey()

      const sourceSelect = screen.getByDisplayValue('HComic')
      await userEvent.selectOptions(sourceSelect, 'moeimg')

      rerender(<SearchPage />)
      const keyAfter = getGridKey()

      expect(keyBefore).not.toBe(keyAfter)
    })

    it('非全量 re-render（仅选中态/下载进度变化）时 grid key 不变', () => {
      mockStoreState.comics = comicsWithResults
      mockStoreState.pagination = { currentPage: 1, totalPages: 1, totalItems: 1 }

      const { rerender } = render(<SearchPage />)
      const keyBefore = getGridKey()

      // 模拟无关状态变化触发 re-render：再次 rerender 同样 props
      rerender(<SearchPage />)
      const keyAfter = getGridKey()

      expect(keyBefore).toBe(keyAfter)
    })

    it('cardStyle 切换时 grid key 不变（layout 位置过渡仍生效）', () => {
      mockStoreState.comics = comicsWithResults
      mockStoreState.pagination = { currentPage: 1, totalPages: 1, totalItems: 1 }

      const { rerender } = render(<SearchPage />)
      const keyCover = getGridKey()

      // 切换到 detailed：cardStyle 不在 key 依赖中，key 应保持不变
      vi.mocked(useSettingsStore).mockReturnValue({ cardStyle: 'detailed', sfwMode: false, tagBlacklist: { hcomic: [], moeimg: [], jm: [], bika: [], copymanga: [], nh: [] }, filterEnabled: true, setFilterEnabled: vi.fn() })
      rerender(<SearchPage />)
      const keyDetailed = getGridKey()

      expect(keyCover).toBe(keyDetailed)
    })
  })

  describe('推荐标签高亮编排', () => {
    // 返回一个完整 enabled 的 settings store mock，可局部覆盖。
    // 新逻辑：高亮数据源为 my_tags（用户主动确认），不再读 favourite_tag_index。
    const enabledSettings = (overrides: Record<string, unknown> = {}) => ({
      cardStyle: 'cover',
      sfwMode: false,
      tagBlacklist: { hcomic: [], moeimg: [], jm: [], bika: [], copymanga: [], nh: [] },
      myTags: { hcomic: [], moeimg: [], jm: [], bika: [], copymanga: [], nh: [] },
      filterEnabled: true,
      setFilterEnabled: vi.fn(),
      favouriteTagHighlight: true,
      favouriteTagMinMatches: 1,
      setFavouriteTagHighlight: vi.fn(),
      setFavouriteTagMinMatches: vi.fn(),
      ...overrides,
    })

    // 依据渲染出的卡片 data-* 属性收集编排结果
    const collectCardStates = () =>
      screen.getAllByTestId('comic-card').map(el => ({
        id: el.getAttribute('data-comic-id')!,
        isRecommended: el.getAttribute('data-recommended') === 'true',
        recTags: el.getAttribute('data-rec-tags') || '',
      }))

    beforeEach(() => {
      vi.mocked(useSettingsStore).mockReturnValue(enabledSettings())
    })

    it('命中 my_tags 的漫画被高亮', () => {
      vi.mocked(useSettingsStore).mockReturnValue(enabledSettings({
        myTags: { hcomic: ['NTR'], moeimg: [], jm: [], bika: [], copymanga: [], nh: [] },
      }))
      mockStoreState.comics = [
        { id: '1', title: '命中', url: '', coverUrl: '', source: 'hcomic', tags: ['NTR'] },
        { id: '2', title: '未命中', url: '', coverUrl: '', source: 'hcomic', tags: ['搞笑'] },
      ]

      render(<SearchPage />)

      const states = collectCardStates()
      expect(states).toContainEqual(expect.objectContaining({ id: '1', isRecommended: true }))
      expect(states).toContainEqual(expect.objectContaining({ id: '2', isRecommended: false }))
    })

    it('my_tags 为空时即使开关开启也不高亮', () => {
      // my_tags 初始为空（升级后空启动场景）， favourite_tag_index 有数据但不生效
      vi.mocked(useSettingsStore).mockReturnValue(enabledSettings({
        myTags: { hcomic: [], moeimg: [], jm: [], bika: [], copymanga: [], nh: [] },
      }))
      mockStoreState.comics = [
        { id: '1', title: '命中', url: '', coverUrl: '', source: 'hcomic', tags: ['NTR'] },
      ]

      render(<SearchPage />)

      const states = collectCardStates()
      expect(states[0].isRecommended).toBe(false)
      expect(states[0].recTags).toBe('')
    })

    it('favouriteTagHighlight 关闭时即使 my_tags 非空也不高亮', () => {
      vi.mocked(useSettingsStore).mockReturnValue(enabledSettings({
        favouriteTagHighlight: false,
        myTags: { hcomic: ['NTR'], moeimg: [], jm: [], bika: [], copymanga: [], nh: [] },
      }))
      mockStoreState.comics = [
        { id: '1', title: '命中', url: '', coverUrl: '', source: 'hcomic', tags: ['NTR'] },
      ]

      render(<SearchPage />)

      const states = collectCardStates()
      expect(states[0].isRecommended).toBe(false)
      expect(states[0].recTags).toBe('')
    })

    it('最小命中数阈值：未达标的漫画不高亮', () => {
      vi.mocked(useSettingsStore).mockReturnValue(enabledSettings({
        favouriteTagMinMatches: 2,
        myTags: { hcomic: ['NTR', '魔法少女'], moeimg: [], jm: [], bika: [], copymanga: [], nh: [] },
      }))
      mockStoreState.comics = [
        { id: '1', title: '命中2', url: '', coverUrl: '', source: 'hcomic', tags: ['NTR', '魔法少女'] },
        { id: '2', title: '仅命中1', url: '', coverUrl: '', source: 'hcomic', tags: ['NTR'] },
      ]

      render(<SearchPage />)

      const states = collectCardStates()
      expect(states).toContainEqual(expect.objectContaining({ id: '1', isRecommended: true }))
      expect(states).toContainEqual(expect.objectContaining({ id: '2', isRecommended: false }))
    })

    it('my_tags 全部参与推荐（无前 10 截断，区别于旧版 favourite_tag_index）', () => {
      const tags15 = Array.from({ length: 15 }, (_, i) => `tag${i}`)
      vi.mocked(useSettingsStore).mockReturnValue(enabledSettings({
        myTags: { hcomic: tags15, moeimg: [], jm: [], bika: [], copymanga: [], nh: [] },
      }))
      // 命中第 15 个标签（旧版会被前 10 截断，新版应高亮）
      mockStoreState.comics = [
        { id: '1', title: '命中第15', url: '', coverUrl: '', source: 'hcomic', tags: ['tag14'] },
      ]

      render(<SearchPage />)

      const states = collectCardStates()
      expect(states[0].isRecommended).toBe(true)
    })

    it('被黑名单屏蔽的漫画不高亮', () => {
      vi.mocked(useSettingsStore).mockReturnValue(enabledSettings({
        filterEnabled: true,
        tagBlacklist: { hcomic: ['NTR'], moeimg: [], jm: [], bika: [], copymanga: [], nh: [] },
        myTags: { hcomic: ['NTR'], moeimg: [], jm: [], bika: [], copymanga: [], nh: [] },
      }))
      mockStoreState.comics = [
        { id: '1', title: '命中但被屏蔽', url: '', coverUrl: '', source: 'hcomic', tags: ['NTR'] },
      ]

      render(<SearchPage />)

      // 被屏蔽的漫画渲染为 BlockedPlaceholder，不渲染 comic-card
      expect(screen.queryAllByTestId('comic-card')).toHaveLength(0)
    })

    it('屏蔽占位符封面变体内容区结构与正常 CoverCard 对齐（防止网格行高错乱）', async () => {
      // 屏蔽占位符的高度必须与正常 CoverCard 一致，否则同行的屏蔽卡片会矮一行，
      // 破坏 CSS Grid 行对齐。校验 padding / 标题 min-h / 作者占位行三处结构。
      vi.mocked(useSettingsStore).mockReturnValue(enabledSettings({
        filterEnabled: true,
        favouriteTagHighlight: false,
        tagBlacklist: { hcomic: ['NTR'], moeimg: [], jm: [], bika: [], copymanga: [], nh: [] },
      }))
      mockStoreState.comics = [
        { id: '1', title: '被屏蔽的漫画', url: '', coverUrl: '', source: 'hcomic', tags: ['NTR'] },
      ]

      render(<SearchPage />)
      const title = await screen.findByText('被屏蔽的漫画')

      // 内容区容器：p-2（非 p-3），与 CoverCard 一致
      const contentBox = title.closest('div')
      expect(contentBox?.className).toContain('p-2')
      expect(contentBox?.className).not.toContain('p-3')
      // 标题最小高度：min-h-[2.5rem]，与 CoverCard 一致
      expect(title.className).toContain('min-h-[2.5rem]')
      // 标题下方作者占位行：h-4 + mt-0.5，仅含 \u00A0 不渲染作者文字
      const placeholder = contentBox?.querySelector('p.h-4')
      expect(placeholder).not.toBeNull()
      expect(placeholder?.className).toContain('mt-0.5')
      expect(placeholder?.textContent).toBe('\u00A0')
    })

    it('屏蔽占位符保留简化视觉语义（line-through 标题、无作者信息）', async () => {
      vi.mocked(useSettingsStore).mockReturnValue(enabledSettings({
        filterEnabled: true,
        favouriteTagHighlight: false,
        tagBlacklist: { hcomic: ['NTR'], moeimg: [], jm: [], bika: [], copymanga: [], nh: [] },
      }))
      mockStoreState.comics = [
        { id: '1', title: '屏蔽项', url: '', coverUrl: '', source: 'hcomic', author: '某作者', pages: 100, tags: ['NTR'] },
      ]

      render(<SearchPage />)
      await screen.findByText('屏蔽项')

      // 标题保留删除线
      expect(screen.getByText('屏蔽项').className).toContain('line-through')
      // 屏蔽卡片是简化占位符：不展示作者 / 页数等元信息
      expect(screen.queryByText('某作者')).not.toBeInTheDocument()
      expect(screen.queryByText(/100\s*页/)).not.toBeInTheDocument()
    })

    it('不支持标签推荐的来源（copymanga）不高亮', async () => {
      // source 经 getConfig 设为 copymanga。setComics 是 no-op mock，故直接预置 comics
      // 作为渲染源；挂载 auth 分支需 verifyAuth 返回有效，mockSearch 返回同数据保持一致。
      mockGetConfig.mockResolvedValue({ config: { defaultSource: 'copymanga' } })
      mockVerifyAuth.mockResolvedValue({ valid: true })
      mockSearch.mockResolvedValue({
        comics: [{ id: '1', title: 'copymanga漫画', url: '', coverUrl: '', source: 'copymanga', tags: ['NTR'] }],
        pagination: null,
      })
      mockStoreState.comics = [
        { id: '1', title: 'copymanga漫画', url: '', coverUrl: '', source: 'copymanga', tags: ['NTR'] },
      ]
      // copymanga 的 my_tags 即使有值也不应高亮（sourceSupportsTagRecommendation 守卫）
      vi.mocked(useSettingsStore).mockReturnValue(enabledSettings({
        myTags: { hcomic: [], moeimg: [], jm: [], bika: [], copymanga: ['NTR'], nh: [] },
      }))

      render(<SearchPage />)
      await waitFor(() => expect(screen.getByText('copymanga漫画')).toBeInTheDocument(), { timeout: 2000 })

      const states = collectCardStates()
      expect(states[0].isRecommended).toBe(false)
      expect(states[0].recTags).toBe('')
    })

    it('标签匹配不区分大小写', () => {
      vi.mocked(useSettingsStore).mockReturnValue(enabledSettings({
        myTags: { hcomic: ['NTR'], moeimg: [], jm: [], bika: [], copymanga: [], nh: [] },
      }))
      mockStoreState.comics = [
        { id: '1', title: '小写标签', url: '', coverUrl: '', source: 'hcomic', tags: ['ntr'] },
      ]

      render(<SearchPage />)

      const states = collectCardStates()
      expect(states[0].isRecommended).toBe(true)
    })
  })
})
