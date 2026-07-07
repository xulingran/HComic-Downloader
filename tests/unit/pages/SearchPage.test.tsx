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
  createSearchContextKey: ({ query, mode, source, searchTags, languageFilter }: { query: string; mode: string; source: string; searchTags: string; languageFilter?: string }) => [source, mode, query.trim(), searchTags, languageFilter ?? ''].join('\u001f'),
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

    expect(mockSearch).toHaveBeenCalledWith('test query', 'keyword', 1, 'hcomic', undefined, true, undefined)
  })

  it('auto-searches with empty keyword on mount', async () => {
    mockSearch.mockResolvedValue({
      comics: [],
      pagination: { currentPage: 1, totalPages: 1, totalItems: 0 }
    })

    render(<SearchPage />)

    // Wait for the async getConfig + search to complete
    await screen.findByPlaceholderText('输入搜索内容...')

    expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 1, 'hcomic', undefined, undefined, undefined)
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
    expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 1, 'hcomic', undefined, true, undefined)
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
    expect(mockSearch).not.toHaveBeenCalled()
    expect(mockRandom).not.toHaveBeenCalled()
    expect(mockVerifyAuth).not.toHaveBeenCalled()

    await user.click(screen.getByText('热门排行'))

    await waitFor(() => {
      expect(mockSearch).toHaveBeenCalledWith('popular-today', 'ranking', 1, 'nh', undefined, undefined, undefined)
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
      expect(mockSearch).toHaveBeenCalledWith('big breasts', 'tag', 1, 'nh', undefined, undefined, undefined)
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
    await waitFor(() => expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 1, 'nh', undefined, undefined, undefined))

    mockSearch.mockClear()
    await user.click(screen.getByText('标签'))
    await user.click(await screen.findByText('big breasts'))

    await waitFor(() => {
      expect(mockSearch).toHaveBeenCalledWith('', 'tag', 1, 'nh', 'big breasts', true, undefined)
    })

    await user.click(screen.getByText('清除全部'))
    await waitFor(() => {
      // 清除全部标签是用户主动操作，与 handleToggleTag 一致透传 allowInteractiveChallenge=true
      expect(mockSearch).toHaveBeenLastCalledWith('', 'tag', 1, 'nh', undefined, true, undefined)
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
    await waitFor(() => expect(mockSearch).toHaveBeenCalledWith('popular-today', 'ranking', 1, 'nh', undefined, undefined, undefined))

    mockSearch.mockClear()
    await user.click(screen.getByText('标签'))
    await user.click(await screen.findByText('full color'))

    await waitFor(() => {
      expect(mockSearch).toHaveBeenCalledWith('', 'tag', 1, 'nh', 'full color', true, undefined)
    })
    expect(mockSearch).not.toHaveBeenCalledWith('popular-today', 'ranking', 1, 'nh', 'full color', undefined, undefined)
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
    expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 2, 'hcomic', undefined, false, undefined)
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
    await waitFor(() => expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 6, 'hcomic', undefined, false, undefined))
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
    await waitFor(() => expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 2, 'hcomic', undefined, false, undefined))

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
      expect(lastCall).toEqual(['', 'keyword', 1, 'moeimg', undefined, undefined, undefined])
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
      expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 1, 'jm', undefined, true, undefined)
      expect(mockRandom).not.toHaveBeenCalled()
    })

    it.each([
      ['valid credentials', { valid: true }],
      ['missing credentials', { valid: false }],
    ])('shows NH entry without auth or automatic content when switching with %s', async (_label, authResult) => {
      mockVerifyAuth.mockResolvedValue(authResult)

      render(<SearchPage />)
      await waitFor(() => expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 1, 'hcomic', undefined, undefined, undefined))
      mockSearch.mockClear()
      mockRandom.mockClear()
      mockVerifyAuth.mockClear()

      await userEvent.selectOptions(screen.getByDisplayValue('HComic'), 'nh')

      expect(await screen.findByText('最近更新')).toBeInTheDocument()
      expect(screen.getByText('热门排行')).toBeInTheDocument()
      expect(screen.getByText('热门标签')).toBeInTheDocument()
      expect(mockSearch).not.toHaveBeenCalled()
      expect(mockRandom).not.toHaveBeenCalled()
      expect(mockVerifyAuth).not.toHaveBeenCalled()
      expect(screen.queryByText(/NH 登录信息已过期或未配置/)).not.toBeInTheDocument()
    })

    it('restores cached NH results and keeps the back-to-entry action', async () => {
      const comic: ComicInfo = {
        id: 'nh-1', title: 'Cached NH Comic', url: '', coverUrl: '', source: 'NH', sourceSite: 'nh',
      }
      mockStoreState.comics = [comic]
      mockStoreState.pagination = { currentPage: 1, totalPages: 1, totalItems: 1 }
      mockSearchCacheStore.currentContextKey = 'nh\u001franking\u001fpopular-today\u001f'
      mockSearchCacheStore.getPage.mockReturnValue({
        query: 'popular-today',
        mode: 'ranking',
        source: 'nh',
        searchTags: '',
        comics: [comic],
        pagination: { currentPage: 1, totalPages: 1, totalItems: 1 },
      })

      render(<SearchPage />)

      expect(await screen.findByText('Cached NH Comic')).toBeInTheDocument()
      expect(screen.getByText('返回 NH 入口')).toBeInTheDocument()
      expect(mockSearch).not.toHaveBeenCalled()
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
        'jm\u001fkeyword\u001f\u001f\u001f',
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
      expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 1, 'jm', undefined, undefined, undefined)
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
      expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 1, 'jm', undefined, true, undefined)
      expect(screen.getByText('JM 登录信息已过期或未配置，请前往设置页面重新登录')).toBeInTheDocument()
    })

    it('keeps the explicit JM random button behavior', async () => {
      render(<SearchPage />)
      await screen.findByPlaceholderText('输入搜索内容...')

      await userEvent.selectOptions(screen.getByDisplayValue('HComic'), 'jm')
      await waitFor(() => expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 1, 'jm', undefined, true, undefined))
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
      expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 1, 'jm', undefined, undefined, undefined)
    })
  })

  // 回归：fix-nh-back-button-persist —— 「返回 NH 入口」按钮在用户进入入口子功能后
  // 必须持续可见，关键词搜索/翻页/排行下拉切换/标签增删均不得隐藏它；仅显式退出入口体系
  // （点返回、切来源、点随机）才隐藏。详见 specs/nh-entry-page/spec.md 新增需求。
  describe('NH 入口子功能返回按钮持续可见', () => {
    const nhComic: ComicInfo = {
      id: 'nh-1', title: 'NH Comic A', url: '', coverUrl: '', source: 'NH', sourceSite: 'nh',
    }
    // 保存原始 no-op mock，afterEach 恢复以防污染同级 describe 块。
    let origSetComics: typeof mockStoreState.setComics
    let origSetPagination: typeof mockStoreState.setPagination

    beforeEach(() => {
      origSetComics = mockStoreState.setComics
      origSetPagination = mockStoreState.setPagination
      mockGetConfig.mockResolvedValue({ config: { defaultSource: 'nh' } })
      mockUseTagList.mockReturnValue({
        getTagList: vi.fn().mockResolvedValue({
          tags: [{ tag: 'full color', count: 100 }, { tag: 'big breasts', count: 200 }],
          total: 2,
        }),
        refreshTagList: vi.fn().mockResolvedValue(undefined),
      })
      // 本组测试需要交互式搜索结果能真正渲染（验证按钮与漫画列表共存），
      // 故让 setComics/setPagination 实际更新 store state（其余 describe 仍用默认 no-op mock）。
      mockStoreState.setComics = vi.fn((c: ComicInfo[]) => { mockStoreState.comics = c })
      mockStoreState.setPagination = vi.fn((p: Record<string, number> | null) => { mockStoreState.pagination = p })
    })

    afterEach(() => {
      mockStoreState.setComics = origSetComics
      mockStoreState.setPagination = origSetPagination
    })

    it('进入热门排行后做关键词搜索时按钮仍可见', async () => {
      const user = userEvent.setup()
      mockSearch.mockResolvedValue({
        comics: [nhComic],
        pagination: { currentPage: 1, totalPages: 2, totalItems: 30 },
      })

      render(<SearchPage />)
      await user.click(await screen.findByText('热门排行'))
      await screen.findByText('NH Comic A')
      expect(screen.getByText('返回 NH 入口')).toBeInTheDocument()

      // 切到关键词模式（ranking 模式无文本输入框）后输入关键词并搜索
      // bug 复现点 —— 原 handleSearch 会把 viewingNhEntry 重置为 false 导致按钮消失
      await user.selectOptions(screen.getByDisplayValue('排行'), 'keyword')
      const input = screen.getByPlaceholderText('输入搜索内容...')
      await user.clear(input)
      await user.type(input, 'keyword-query')
      mockSearch.mockResolvedValue({
        comics: [{ ...nhComic, id: 'nh-2', title: 'NH Keyword Result' }],
        pagination: { currentPage: 1, totalPages: 1, totalItems: 1 },
      })
      await user.click(screen.getByText('搜索'))

      expect(await screen.findByText('NH Keyword Result')).toBeInTheDocument()
      // 修复后：按钮必须仍然可见
      expect(screen.getByText('返回 NH 入口')).toBeInTheDocument()
    })

    it('进入最近更新后翻页时按钮仍可见', async () => {
      const user = userEvent.setup()
      mockSearch.mockResolvedValue({
        comics: [nhComic],
        pagination: { currentPage: 1, totalPages: 3, totalItems: 30 },
      })

      render(<SearchPage />)
      await user.click(await screen.findByText('最近更新'))
      await screen.findByText('NH Comic A')
      expect(screen.getByText('返回 NH 入口')).toBeInTheDocument()

      mockSearch.mockResolvedValue({
        comics: [{ ...nhComic, id: 'nh-p2', title: 'NH Page 2 Comic' }],
        pagination: { currentPage: 2, totalPages: 3, totalItems: 30 },
      })
      // SearchBar 顶栏与底部 PaginationControls 各有一个「下一页」，取第一个
      await user.click(screen.getAllByText('下一页')[0])

      expect(await screen.findByText('NH Page 2 Comic')).toBeInTheDocument()
      expect(screen.getByText('返回 NH 入口')).toBeInTheDocument()
    })

    it('在入口子功能内切换排行下拉时按钮仍可见', async () => {
      const user = userEvent.setup()
      mockSearch.mockResolvedValue({
        comics: [nhComic],
        pagination: { currentPage: 1, totalPages: 2, totalItems: 30 },
      })

      render(<SearchPage />)
      await user.click(await screen.findByText('热门排行'))
      await screen.findByText('NH Comic A')
      expect(screen.getByText('返回 NH 入口')).toBeInTheDocument()

      // 切换排行下拉（NH ranking select）。query select 的值变化触发 onNhRankingChange。
      const rankingSelect = screen.getByDisplayValue('今日热门')
      mockSearch.mockResolvedValue({
        comics: [{ ...nhComic, id: 'nh-week', title: 'NH Week Popular' }],
        pagination: { currentPage: 1, totalPages: 2, totalItems: 30 },
      })
      await user.selectOptions(rankingSelect, 'popular-week')

      expect(await screen.findByText('NH Week Popular')).toBeInTheDocument()
      expect(screen.getByText('返回 NH 入口')).toBeInTheDocument()
    })

    it('点击返回入口页后按钮隐藏且入口页网格重现', async () => {
      const user = userEvent.setup()
      mockSearch.mockResolvedValue({
        comics: [nhComic],
        pagination: { currentPage: 1, totalPages: 2, totalItems: 30 },
      })

      render(<SearchPage />)
      await user.click(await screen.findByText('热门排行'))
      await screen.findByText('NH Comic A')
      expect(screen.getByText('返回 NH 入口')).toBeInTheDocument()

      await user.click(screen.getByText('返回 NH 入口'))

      // 按钮隐藏
      expect(screen.queryByText('返回 NH 入口')).not.toBeInTheDocument()
      // 入口页网格重现（最近更新 / 热门排行 / 热门标签区域）
      expect(await screen.findByText('最近更新')).toBeInTheDocument()
      expect(screen.getByText('热门排行')).toBeInTheDocument()
    })

    it('切到非 NH 来源时按钮隐藏', async () => {
      const user = userEvent.setup()
      mockSearch.mockResolvedValue({
        comics: [nhComic],
        pagination: { currentPage: 1, totalPages: 2, totalItems: 30 },
      })

      render(<SearchPage />)
      await user.click(await screen.findByText('热门排行'))
      await screen.findByText('NH Comic A')
      expect(screen.getByText('返回 NH 入口')).toBeInTheDocument()

      mockSearch.mockResolvedValue({
        comics: [{ id: 'hc-1', title: 'HComic Result', url: '', coverUrl: '', source: 'hcomic' }],
        pagination: { currentPage: 1, totalPages: 1, totalItems: 1 },
      })
      await user.selectOptions(screen.getByDisplayValue('NH'), 'hcomic')

      expect(screen.queryByText('返回 NH 入口')).not.toBeInTheDocument()
    })

    it('挂载恢复 NH + keyword 模式缓存时按钮仍可见且入口页网格不重现（选项 B）', async () => {
      // 复现：用户在入口子功能里做关键词搜索后离开页面，回来时缓存恢复。
      // 选项 B：按钮必须显示（用户仍在 NH 体系内），入口页网格不重现（keyword 搜索结果有效）。
      mockStoreState.comics = [nhComic]
      mockStoreState.pagination = { currentPage: 1, totalPages: 1, totalItems: 1 }
      mockSearchCacheStore.currentContextKey = 'nh\u001fkeyword\u001fsome-query\u001f'
      mockSearchCacheStore.currentPage = 1
      mockSearchCacheStore.getPage.mockReturnValue({
        query: 'some-query',
        mode: 'keyword',
        source: 'nh',
        searchTags: '',
        comics: [nhComic],
        pagination: { currentPage: 1, totalPages: 1, totalItems: 1 },
      })

      render(<SearchPage />)

      expect(await screen.findByText('NH Comic A')).toBeInTheDocument()
      // 选项 B：按钮仍可见
      expect(screen.getByText('返回 NH 入口')).toBeInTheDocument()
      // 入口页网格不重现（keyword 搜索结果展示中，不该被入口网格覆盖）
      expect(screen.queryByText('最近更新')).not.toBeInTheDocument()
      expect(screen.queryByText('热门排行')).not.toBeInTheDocument()
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

    it('未提交的 query 变化时 grid key 不变（不闪烁）', async () => {
      // 修复回归：fix-search-flicker-on-keystroke —— 用户在搜索栏打字/删除修改未提交的 query 时，
      // 结果容器的 key 必须保持稳定，避免整体 remount 引发卡片进出场动画重放（闪烁）。
      // key 现派生自「已加载上下文」loadedContextKey，仅在搜索真正完成时更新。
      mockStoreState.comics = comicsWithResults
      mockStoreState.pagination = { currentPage: 1, totalPages: 1, totalItems: 1 }

      const { rerender } = render(<SearchPage />)
      const keyBefore = getGridKey()

      // 输入新 query 但不提交（不按 Enter、不点搜索按钮）
      const input = screen.getByPlaceholderText('输入搜索内容...')
      await userEvent.type(input, 'newquery')

      rerender(<SearchPage />)
      const keyAfterTyping = getGridKey()

      expect(keyBefore).toBe(keyAfterTyping)

      // 删除文字也不应改变 key
      await userEvent.clear(input)
      rerender(<SearchPage />)
      const keyAfterClear = getGridKey()

      expect(keyBefore).toBe(keyAfterClear)
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

    it('首次进入无搜索时 grid key 含 initial 占位值', () => {
      // spec 场景：首次进入页面无搜索时容器拥有稳定占位 key
      // loadedContextKey 为 null → gridContainerKey 使用 INITIAL_GRID_KEY ('initial') 兜底。
      // 通过直接预置 comics 让 grid 容器渲染（绕过搜索流程，loadedContextKey 保持 null）。
      mockStoreState.comics = comicsWithResults
      mockStoreState.pagination = { currentPage: 1, totalPages: 1, totalItems: 1 }

      render(<SearchPage />)

      const key = getGridKey()
      expect(key).not.toBeNull()
      // 未发起搜索时占位 key 必须含 'initial'
      expect(key).toContain('initial')
    })

    it('提交搜索后 grid key 切换为新已加载上下文', async () => {
      // spec 场景：提交搜索后容器 key 按预期切换
      // 流程：预置初始 comics（loadedContextKey 仍为 null → 'initial:1'）
      //      → 输入 query + 点搜索按钮 → 搜索完成 → loadedContextKey 更新 → key 切换
      // setComics/setPagination 需真实更新 store 才能让搜索结果渲染并使 grid 容器存在
      const origSetComics = mockStoreState.setComics
      const origSetPagination = mockStoreState.setPagination
      mockStoreState.setComics = vi.fn((c: ComicInfo[]) => { mockStoreState.comics = c })
      mockStoreState.setPagination = vi.fn((p: Record<string, number> | null) => { mockStoreState.pagination = p })
      // 直接按 data-grid-key 属性定位最新挂载的 grid 容器（适配搜索后文本变化场景）
      const getLatestGridKey = () => {
        const grids = document.querySelectorAll('[data-grid-key]')
        const last = grids[grids.length - 1]
        return last?.getAttribute('data-grid-key') ?? null
      }

      try {
        mockStoreState.comics = comicsWithResults
        mockStoreState.pagination = { currentPage: 1, totalPages: 1, totalItems: 1 }
        // 挂载时不触发自动搜索的查询返回（保持 loadedContextKey 为 null）
        mockSearch.mockResolvedValue({
          comics: [{ id: '2', title: 'Searched Comic', url: '', coverUrl: '', source: 'test' }],
          pagination: { currentPage: 1, totalPages: 1, totalItems: 1 },
        })

        render(<SearchPage />)
        await screen.findByText('Comic A')
        const keyBefore = getLatestGridKey()
        // 初始未完成搜索时 key 应含 initial 占位
        expect(keyBefore).toContain('initial')

        const input = screen.getByPlaceholderText('输入搜索内容...')
        await userEvent.clear(input)
        await userEvent.type(input, 'submitted-query')
        await userEvent.click(screen.getByText('搜索'))

        // 搜索完成后 loadedContextKey 更新为新上下文，key 切换
        await screen.findByText('Searched Comic')
        const keyAfter = getLatestGridKey()

        expect(keyBefore).not.toBe(keyAfter)
        // 新 key 应包含已加载的 query 上下文（不再含 initial 占位）
        expect(keyAfter).not.toContain('initial')
      } finally {
        mockStoreState.setComics = origSetComics
        mockStoreState.setPagination = origSetPagination
      }
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

  // ── NH「仅显示中文」筛选（add-nh-chinese-language-filter spec）──────────────
  describe('NH language filter', () => {
    it('默认关闭，且仅在 NH 来源显示控件', async () => {
      mockGetConfig.mockResolvedValue({ config: { defaultSource: 'nh' } })
      render(<SearchPage />)

      // NH 入口页：控件可见，且默认未勾选
      await waitFor(() => expect(screen.getByText('NH')).toBeInTheDocument())
      const nhCheckbox = screen.getByRole('checkbox', { name: /仅显示中文/ }) as HTMLInputElement
      expect(nhCheckbox).toBeInTheDocument()
      expect(nhCheckbox.checked).toBe(false)
    })

    it('非 NH 来源不展示「仅显示中文」控件', async () => {
      mockGetConfig.mockResolvedValue({ config: { defaultSource: 'hcomic' } })
      render(<SearchPage />)

      await waitFor(() => expect(screen.getByText('HComic')).toBeInTheDocument())
      expect(screen.queryByRole('checkbox', { name: /仅显示中文/ })).toBeNull()
    })

    it('入口页切换筛选只更新状态不发起请求', async () => {
      const user = userEvent.setup()
      mockGetConfig.mockResolvedValue({ config: { defaultSource: 'nh' } })
      render(<SearchPage />)

      await waitFor(() => expect(screen.getByText('NH')).toBeInTheDocument())
      mockSearch.mockClear()

      const checkbox = screen.getByRole('checkbox', { name: /仅显示中文/ }) as HTMLInputElement
      await user.click(checkbox)

      // 入口页本体（无可见结果）：禁止自动内容请求
      expect(mockSearch).not.toHaveBeenCalled()
      expect(checkbox.checked).toBe(true)
    })

    it('入口动作（最近更新）应用当前筛选状态', async () => {
      const user = userEvent.setup()
      mockGetConfig.mockResolvedValue({ config: { defaultSource: 'nh' } })
      render(<SearchPage />)

      await waitFor(() => expect(screen.getByText('NH')).toBeInTheDocument())
      // 先在入口页开启筛选（不触发请求）
      const checkbox = screen.getByRole('checkbox', { name: /仅显示中文/ }) as HTMLInputElement
      await user.click(checkbox)
      mockSearch.mockClear()

      // 点击最近更新：请求必须携带 languageFilter='chinese'
      await user.click(screen.getByText('最近更新'))
      await waitFor(() => {
        expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 1, 'nh', undefined, undefined, 'chinese')
      })
    })

    it('入口动作把中文结果写入独立的筛选缓存上下文', async () => {
      const user = userEvent.setup()
      mockGetConfig.mockResolvedValue({ config: { defaultSource: 'nh' } })
      mockSearch.mockResolvedValue({
        comics: [{ id: 'zh-1', title: '中文结果', url: '', coverUrl: '', source: 'NH', language: 'chinese' }],
        pagination: { currentPage: 1, totalPages: 2, totalItems: 26 },
      })

      render(<SearchPage />)
      await waitFor(() => expect(screen.getByText('最近更新')).toBeInTheDocument())
      await user.click(screen.getByRole('checkbox', { name: /仅显示中文/ }))
      mockSearchCacheStore.setPage.mockClear()

      await user.click(screen.getByText('最近更新'))

      await waitFor(() => expect(mockSearchCacheStore.setPage).toHaveBeenCalled())
      const [contextKey, page, cachedPage] = mockSearchCacheStore.setPage.mock.calls.at(-1)!
      expect(contextKey).toBe('nh\u001fkeyword\u001f\u001f\u001fchinese')
      expect(page).toBe(1)
      expect(cachedPage).toEqual(expect.objectContaining({
        source: 'nh',
        languageFilter: 'chinese',
      }))
    })

    it('热门排行入口也透传筛选状态', async () => {
      const user = userEvent.setup()
      mockGetConfig.mockResolvedValue({ config: { defaultSource: 'nh' } })
      render(<SearchPage />)

      await waitFor(() => expect(screen.getByText('NH')).toBeInTheDocument())
      const checkbox = screen.getByRole('checkbox', { name: /仅显示中文/ }) as HTMLInputElement
      await user.click(checkbox)

      mockSearch.mockClear()
      await user.click(screen.getByText('热门排行'))
      await waitFor(() => expect(mockSearch).toHaveBeenCalledWith('popular-today', 'ranking', 1, 'nh', undefined, undefined, 'chinese'))
    })

    it('结果页切换筛选从第 1 页重新搜索并携带筛选', async () => {
      const user = userEvent.setup()
      mockGetConfig.mockResolvedValue({ config: { defaultSource: 'nh' } })
      // 模拟搜索返回结果：让点击「最近更新」后 store 有数据，进入「结果页」语义
      mockSearch.mockResolvedValueOnce({
        comics: [{ id: '1', title: 'Comic A', url: '', coverUrl: '', source: 'nh' }],
        pagination: { currentPage: 1, totalPages: 3, totalItems: 30 },
      })

      render(<SearchPage />)
      await waitFor(() => expect(screen.getByText('NH')).toBeInTheDocument())
      await user.click(screen.getByText('最近更新'))
      await waitFor(() => expect(mockSearch).toHaveBeenCalledWith('', 'keyword', 1, 'nh', undefined, undefined, undefined))

      mockSearch.mockClear()
      const checkbox = screen.getByRole('checkbox', { name: /仅显示中文/ }) as HTMLInputElement
      await user.click(checkbox)

      // 结果页切换：必须从第 1 页重新搜索并携带筛选
      await waitFor(() => {
        expect(mockSearch).toHaveBeenCalledWith(expect.anything(), expect.anything(), 1, 'nh', undefined, true, 'chinese')
      })
    })

    it('切换到其他来源不携带筛选参数', async () => {
      const user = userEvent.setup()
      mockGetConfig.mockResolvedValue({ config: { defaultSource: 'nh' } })
      render(<SearchPage />)

      await waitFor(() => expect(screen.getByText('NH')).toBeInTheDocument())
      const checkbox = screen.getByRole('checkbox', { name: /仅显示中文/ }) as HTMLInputElement
      await user.click(checkbox)

      // 切到 hcomic：请求末尾的 languageFilter 必须是 undefined
      mockSearch.mockClear()
      // NH 入口页的第一个 select 是来源选择器
      const selects = screen.getAllByRole('combobox')
      await user.selectOptions(selects[0], 'hcomic')
      await waitFor(() => expect(mockSearch).toHaveBeenCalled())
      const lastCall = mockSearch.mock.calls[mockSearch.mock.calls.length - 1]
      expect(lastCall[3]).toBe('hcomic')
      expect(lastCall[6]).toBeUndefined() // 非 NH 来源不携带 languageFilter
    })

    it('切到非 NH 后的标签搜索不携带残留的 NH 语言筛选', async () => {
      // 回归守护：审查发现 handleToggleTag/handleClearAllTags 曾直接透传 nhLanguageFilterRef，
      // 而 design 决策 3 要求切源时保留筛选状态——两者叠加会让「NH 开筛选 → 切 hcomic → 点标签」
      // 携带 source='hcomic' + languageFilter='chinese'，触发主进程跨来源拒绝。
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
      await waitFor(() => expect(screen.getByText('NH')).toBeInTheDocument())
      // 在 NH 入口页开启筛选（不触发请求）
      const checkbox = screen.getByRole('checkbox', { name: /仅显示中文/ }) as HTMLInputElement
      await user.click(checkbox)

      // 切到 hcomic（supportsTagList=true，标签按钮可见）
      const selects = screen.getAllByRole('combobox')
      await user.selectOptions(selects[0], 'hcomic')
      await waitFor(() => expect(mockSearch).toHaveBeenCalled())

      // 在 hcomic 下点选标签：最后一次 search 的 languageFilter（第 8 参数）必须 undefined
      mockSearch.mockClear()
      await user.click(screen.getByText('标签'))
      await user.click(await screen.findByText('full color'))

      await waitFor(() => expect(mockSearch).toHaveBeenCalled())
      const lastCall = mockSearch.mock.calls[mockSearch.mock.calls.length - 1]
      expect(lastCall[3]).toBe('hcomic')
      expect(lastCall[6]).toBeUndefined() // 残留的 NH 筛选不得泄漏到 hcomic 标签搜索
    })
  })
})
