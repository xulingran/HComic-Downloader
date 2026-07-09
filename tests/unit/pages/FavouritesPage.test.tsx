import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
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
  useSettingsStore: vi.fn().mockReturnValue({
    cardStyle: 'cover',
    defaultFavouriteSource: 'hcomic',
    tagBlacklist: { hcomic: [], moeimg: [], jm: [], bika: [], copymanga: [] },
    filterEnabled: true,
    setFilterEnabled: vi.fn(),
    addTag: vi.fn(),
    removeTag: vi.fn(),
  })
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
    sessionPickerShown: true,
    setPage: vi.fn(),
    getPage: vi.fn(),
    hasPage: vi.fn().mockReturnValue(false),
    clearCache: vi.fn(),
    setCurrentSource: vi.fn(),
    markPickerShown: vi.fn(),
  },
}))

vi.mock('@/stores/useFavouritesStore', () => ({
  // 支持两种调用形式：useFavouritesStore() 返回完整对象；
  // useFavouritesStore(selector) 返回 selector(完整对象)。
  useFavouritesStore: vi.fn().mockImplementation((selector?: (s: typeof mockFavouritesStore) => unknown) => {
    if (typeof selector === 'function') return selector(mockFavouritesStore)
    return mockFavouritesStore
  }),
}))

vi.mock('@/components/common/ComicCard', () => ({
  ComicCard: ({ comic }: { comic: ComicInfo }) => (
    <div data-testid="comic-card">{comic.title}</div>
  )
}))

// Import the component AFTER mocks
import { FavouritesPage } from '@/pages/FavouritesPage'

interface FavouritesResult {
  comics: ComicInfo[]
  pagination?: { currentPage: number; totalPages: number; totalItems: number }
  needsLogin?: boolean
}

// 控制某次 getFavourites 的返回时机，用于模拟迟到完成的预加载请求
function createDeferredFavourites() {
  let resolve!: (value: FavouritesResult) => void
  const promise = new Promise<FavouritesResult>((res) => { resolve = res })
  return { promise, resolve }
}

describe('FavouritesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetFavourites.mockResolvedValue({ comics: [] })
    mockCheckDownloadedStatus.mockResolvedValue({ statusMap: {} })
    mockFavouritesStore.caches = {}
    mockFavouritesStore.currentSource = 'hcomic'
    mockFavouritesStore.currentPage = 1
    mockFavouritesStore.hasCache = false
    mockFavouritesStore.sessionPickerShown = true
    mockFavouritesStore.getPage.mockReset()
    mockFavouritesStore.hasPage.mockReset()
    mockFavouritesStore.hasPage.mockReturnValue(false)
    mockFavouritesStore.setPage.mockReset()
    mockFavouritesStore.clearCache.mockReset()
    mockFavouritesStore.setCurrentSource.mockReset()
    mockFavouritesStore.markPickerShown.mockReset()
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

  // 已删除 'calls getFavourites on mount'（cleanup-test-quality-backlog Phase B）：
  // 原仅断言 mockGetFavourites.toHaveBeenCalled()，是裸 mock 调用断言。mount 触发数据
  // 加载的意图已由同文件"渲染收藏/Failed to load"等用例通过真实渲染结果覆盖。
  // 无独立信号，删除。

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

  it('翻页未命中缓存时保留旧结果并叠加 light 档遮罩（backdrop-blur-[8px] + spinner）', async () => {
    // 首屏第 1 页立即返回带分页结果（使翻页按钮 + 旧内容可见），第 2 页未命中缓存且加载挂起
    const deferredPage2 = createDeferredFavourites()
    mockGetFavourites.mockImplementation((page: number, _source?: string, _interactive?: boolean) =>
      page === 2
        ? deferredPage2.promise
        : Promise.resolve({
          comics: [{ id: '1', title: 'Old Favourite', url: 'https://example.com/1', coverUrl: '', source: 'test' }],
          pagination: { currentPage: 1, totalPages: 3, totalItems: 30 },
          needsLogin: false,
        })
    )
    // 目标页无缓存 → 走 isLoading 遮罩路径（非缓存即时显示）
    mockFavouritesStore.hasPage.mockReturnValue(false)

    render(<FavouritesPage />)
    await screen.findByText('Old Favourite')

    // 翻页到第 2 页（无缓存 → 加载挂起 → 旧结果保留 + 遮罩）
    await userEvent.click((await screen.findAllByText('下一页'))[0])

    // 旧结果仍渲染（未被卸载）
    expect(screen.getByText('Old Favourite')).toBeInTheDocument()
    // LoadingOverlay light 档：backdrop-blur-[8px] + bg/80 + spinner
    const overlay = document.querySelector('.fixed.inset-0.backdrop-blur-\\[8px\\]') as HTMLElement | null
    expect(overlay).not.toBeNull()
    expect(overlay?.className).toContain('bg-[var(--bg-primary)]/80')
    expect(overlay?.querySelector('.rounded-full.motion-safe\\:animate-spin')).not.toBeNull()
    expect(overlay?.textContent).toContain('加载中')

    deferredPage2.resolve({ comics: [], pagination: { currentPage: 2, totalPages: 3, totalItems: 30 }, needsLogin: false })
    await act(async () => { await deferredPage2.promise.catch(() => {}) })
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
    // 缓存后台刷新：非交互（allowInteractiveChallenge=false）
    expect(mockGetFavourites).toHaveBeenCalledWith(2, 'hcomic', false)
  })

  it('preloads nearby favourites pages after current page is loaded', async () => {
    mockGetFavourites.mockResolvedValue({
      comics: [{ id: '5', title: 'Current Favourite', url: 'https://example.com/5', coverUrl: '', source: 'test' }],
      pagination: { currentPage: 5, totalPages: 10, totalItems: 100 },
      needsLogin: false,
    })

    render(<FavouritesPage />)

    await screen.findByText('Current Favourite')
    // 相邻页预加载：非交互（allowInteractiveChallenge=false）
    await waitFor(() => expect(mockGetFavourites).toHaveBeenCalledWith(6, 'hcomic', false))
  })

  it('does not commit stale preload results after switching source', async () => {
    // 回归：来源 A 的相邻页预加载请求在切换到来源 B 后才返回时，必须被丢弃，
    // 既不写入 preloadedPagesRef，也不经 commitPage 提交到 favourites 缓存（setPage）。
    // 用「来源 + 页码」键控 getFavourites mock：
    // - 来源 hcomic 第 1 页（首屏）立即返回
    // - 来源 hcomic 第 2 页（预加载）挂起，模拟网络往返迟到
    // - 来源 moeimg 任意页立即返回空（切换后首屏）
    const deferredPage2 = createDeferredFavourites()
    mockGetFavourites.mockImplementation((page: number, source?: string) => {
      if (source === 'hcomic' && page === 2) return deferredPage2.promise
      if (source === 'hcomic') {
        return Promise.resolve({
          comics: [{ id: '1', title: 'Page1 Fav', url: '', coverUrl: '', source: 'test' }],
          pagination: { currentPage: 1, totalPages: 3, totalItems: 30 },
          needsLogin: false,
        })
      }
      return Promise.resolve({ comics: [], pagination: { currentPage: 1, totalPages: 1, totalItems: 0 } })
    })

    render(<FavouritesPage />)
    await screen.findByText('Page1 Fav')
    // 等到来源 hcomic 的第 2 页预加载请求已发出（仍挂起）
    await waitFor(() => expect(mockGetFavourites).toHaveBeenCalledWith(2, 'hcomic', false))

    // 切换到来源 moeimg——contextKey 变化，旧来源预加载被中断
    await userEvent.click(screen.getByRole('button', { name: 'MoeImg' }))

    // 让来源 hcomic 的迟到预加载请求返回
    deferredPage2.resolve({
      comics: [{ id: '2', title: 'Stale HComic Page 2', url: '', coverUrl: '', source: 'test' }],
      pagination: { currentPage: 2, totalPages: 3, totalItems: 30 },
      needsLogin: false,
    })
    await act(async () => { await deferredPage2.promise })

    // 断言：迟到结果未提交到 favourites 缓存——来源 hcomic 的第 2 页永不出现在 setPage 调用里
    const committedPage2ForHcomic = mockFavouritesStore.setPage.mock.calls.filter(
      ([source, page]) => source === 'hcomic' && page === 2,
    )
    expect(committedPage2ForHcomic).toHaveLength(0)
  })

  describe('来源侧边栏切换', () => {
    it('移除来源下拉框并通过侧边栏加载目标来源第一页', async () => {
      mockGetFavourites.mockImplementation((_page: number, source?: string) => Promise.resolve({
        comics: [{
          id: source === 'jm' ? 'jm-1' : 'hcomic-1',
          title: source === 'jm' ? 'JM Favourite' : 'HComic Favourite',
          url: '',
          coverUrl: '',
          source: source ?? 'hcomic',
        }],
        pagination: { currentPage: 1, totalPages: 1, totalItems: 1 },
      }))

      render(<FavouritesPage />)
      await screen.findByText('HComic Favourite')

      expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'JM' }))

      expect(await screen.findByText('JM Favourite')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'JM' })).toHaveAttribute('aria-current', 'page')
      expect(mockGetFavourites).toHaveBeenCalledWith(1, 'jm', true)
    })

    it('切换到已有第一页缓存时立即显示缓存并后台刷新', async () => {
      mockFavouritesStore.getPage.mockImplementation((source: string, page: number) => {
        if (source !== 'jm' || page !== 1) return undefined
        return {
          comics: [{ id: 'cached-jm', title: 'Cached JM Favourite', url: '', coverUrl: '', source: 'jm' }],
          pagination: { currentPage: 1, totalPages: 1, totalItems: 1 },
          currentPage: 1,
          downloadedStatus: {},
        }
      })
      mockGetFavourites.mockImplementation((_page: number, source?: string) => {
        if (source === 'jm') return new Promise(() => {})
        return Promise.resolve({
          comics: [{ id: 'hcomic-1', title: 'HComic Favourite', url: '', coverUrl: '', source: 'hcomic' }],
          pagination: { currentPage: 1, totalPages: 1, totalItems: 1 },
        })
      })

      render(<FavouritesPage />)
      await screen.findByText('HComic Favourite')
      await userEvent.click(screen.getByRole('button', { name: 'JM' }))

      expect(await screen.findByText('Cached JM Favourite')).toBeInTheDocument()
      expect(mockGetFavourites).toHaveBeenCalledWith(1, 'jm', false)
    })

    it('重复点击当前来源不会重新请求', async () => {
      mockGetFavourites.mockResolvedValue({
        comics: [{ id: 'hcomic-1', title: 'HComic Favourite', url: '', coverUrl: '', source: 'hcomic' }],
        pagination: { currentPage: 1, totalPages: 1, totalItems: 1 },
      })

      render(<FavouritesPage />)
      await screen.findByText('HComic Favourite')
      mockGetFavourites.mockClear()

      await userEvent.click(screen.getByRole('button', { name: 'HComic' }))

      expect(screen.getByText('HComic Favourite')).toBeInTheDocument()
      expect(mockGetFavourites).not.toHaveBeenCalled()
    })

    it('旧来源第一页迟到时只写入原来源缓存且不覆盖当前内容', async () => {
      const deferredHcomic = createDeferredFavourites()
      mockGetFavourites.mockImplementation((_page: number, source?: string) => {
        if (source === 'hcomic') return deferredHcomic.promise
        return Promise.resolve({
          comics: [{ id: 'jm-1', title: 'Current JM Favourite', url: '', coverUrl: '', source: 'jm' }],
          pagination: { currentPage: 1, totalPages: 1, totalItems: 1 },
        })
      })

      render(<FavouritesPage />)
      await userEvent.click(screen.getByRole('button', { name: 'JM' }))
      await screen.findByText('Current JM Favourite')

      deferredHcomic.resolve({
        comics: [{ id: 'stale-hcomic', title: 'Stale HComic Favourite', url: '', coverUrl: '', source: 'hcomic' }],
        pagination: { currentPage: 1, totalPages: 1, totalItems: 1 },
      })
      await act(async () => { await deferredHcomic.promise })

      expect(screen.getByText('Current JM Favourite')).toBeInTheDocument()
      expect(screen.queryByText('Stale HComic Favourite')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'JM' })).toHaveAttribute('aria-current', 'page')
      expect(mockFavouritesStore.setPage).toHaveBeenCalledWith(
        'hcomic',
        1,
        expect.objectContaining({
          comics: [expect.objectContaining({ id: 'stale-hcomic' })],
        }),
        false,
      )
      expect(mockFavouritesStore.setPage).toHaveBeenCalledWith(
        'jm',
        1,
        expect.objectContaining({
          comics: [expect.objectContaining({ id: 'jm-1' })],
        }),
        true,
      )
    })

    it('使用双侧栏网格断点避免中等宽度强制五列', async () => {
      mockGetFavourites.mockResolvedValue({
        comics: [{ id: '1', title: 'Responsive Favourite', url: '', coverUrl: '', source: 'hcomic' }],
        pagination: { currentPage: 1, totalPages: 1, totalItems: 1 },
      })

      render(<FavouritesPage />)
      await screen.findByText('Responsive Favourite')

      const grid = document.querySelector('[data-grid-key]')
      expect(grid).toHaveClass('md:grid-cols-3', 'lg:grid-cols-4', 'xl:grid-cols-5')
    })
  })

  // 回归：封面从左上角飞入 bug 修复（与 SearchPage 同源）。
  // grid 容器 key 由「来源 + 页码」派生，全量替换时整页重挂载。
  describe('卡片列表整页重挂载 key（防 layout 飞入）', () => {
    const getGridKey = () => {
      // AnimatePresence popLayout 在 exit 动画期间会同时保留新旧 grid 容器，取最后一个（最新挂载）。
      const grids = document.querySelectorAll('[data-grid-key]')
      const last = grids[grids.length - 1]
      return last?.getAttribute('data-grid-key') ?? null
    }

    it('翻页（currentPage 变化）时 grid key 改变', async () => {
      mockFavouritesStore.hasPage.mockReturnValue(true)
      mockGetFavourites.mockResolvedValueOnce({
        comics: [{ id: '1', title: 'Page1 Fav', url: '', coverUrl: '', source: 'test' }],
        pagination: { currentPage: 1, totalPages: 3, totalItems: 30 },
        needsLogin: false,
      }).mockReturnValue(new Promise(() => {}))
      mockFavouritesStore.getPage.mockImplementation((_source: string, page: number) => {
        if (page !== 2) return undefined
        return {
          comics: [{ id: '2', title: 'Page2 Fav', url: '', coverUrl: '', source: 'test' }],
          pagination: { currentPage: 2, totalPages: 3, totalItems: 30 },
          currentPage: 2,
          downloadedStatus: {},
        }
      })

      render(<FavouritesPage />)
      await screen.findByText('Page1 Fav')
      const keyPage1 = getGridKey()

      await userEvent.click((await screen.findAllByText('下一页'))[0])
      await screen.findByText('Page2 Fav')
      const keyPage2 = getGridKey()

      expect(keyPage1).not.toBeNull()
      expect(keyPage2).not.toBeNull()
      expect(keyPage1).not.toBe(keyPage2)
    })

    it('grid key 格式为 source:currentPage', async () => {
      mockGetFavourites.mockResolvedValue({
        comics: [{ id: '1', title: 'Fav A', url: '', coverUrl: '', source: 'test' }],
        pagination: { currentPage: 1, totalPages: 1, totalItems: 1 },
        needsLogin: false,
      })

      render(<FavouritesPage />)
      await screen.findByText('Fav A')

      // 初始 source='hcomic'（来自 store mock currentSource）、currentPage=1
      expect(getGridKey()).toBe('hcomic:1')
    })
  })

  // ── 任务 6.3：交互恢复前台/后台区分测试 ──────────────────────────────────
  describe('交互挑战恢复 allowInteractiveChallenge 区分', () => {
    it('无缓存主动加载启用交互恢复（allowInteractiveChallenge=true）', async () => {
      mockGetFavourites.mockResolvedValue({ comics: [] })
      render(<FavouritesPage />)
      await screen.findByText('暂无收藏')
      // 首次无缓存主动加载：第三个参数应为 true
      expect(mockGetFavourites).toHaveBeenCalledWith(1, 'hcomic', true)
    })

    it('用户刷新按钮触发主动加载（启用交互恢复）', async () => {
      mockGetFavourites.mockResolvedValue({ comics: [] })
      render(<FavouritesPage />)
      await screen.findByText('暂无收藏')
      mockGetFavourites.mockClear()

      await userEvent.click(screen.getByText('刷新'))

      // 刷新走无缓存主动加载路径：allowInteractiveChallenge=true
      await waitFor(() => {
        expect(mockGetFavourites).toHaveBeenCalledWith(1, 'hcomic', true)
      })
    })

    it('缓存后台刷新不启用交互恢复（allowInteractiveChallenge=false）', async () => {
      mockFavouritesStore.hasPage.mockReturnValue(true)
      // 第 1 页主动加载返回带分页的结果（使翻页按钮出现）
      mockGetFavourites.mockResolvedValue({
        comics: [{ id: '1', title: 'Page1', url: '', coverUrl: '', source: 'test' }],
        pagination: { currentPage: 1, totalPages: 3, totalItems: 30 },
        needsLogin: false,
      })
      // 第 2 页有缓存
      mockFavouritesStore.getPage.mockImplementation((_source: string, page: number) => {
        if (page !== 2) return undefined
        return {
          comics: [{ id: '2', title: 'Cached', url: '', coverUrl: '', source: 'test' }],
          pagination: { currentPage: 2, totalPages: 3, totalItems: 30 },
          currentPage: 2,
          downloadedStatus: {},
        }
      })

      render(<FavouritesPage />)
      await screen.findByText('Page1')
      // 翻到有缓存的第 2 页 → 触发缓存后台刷新
      await userEvent.click((await screen.findAllByText('下一页'))[0])

      // 缓存后台刷新：第三个参数应为 false（不弹窗）
      await waitFor(() => {
        expect(mockGetFavourites).toHaveBeenCalledWith(2, 'hcomic', false)
      })
    })

    it('恢复取消（无缓存）显示可重试错误，不显示登录失效', async () => {
      // 主进程恢复取消时抛出的错误 message 不含 403/登录失效
      mockGetFavourites.mockRejectedValue(new Error('已取消'))
      render(<FavouritesPage />)

      // 显示错误提示（可重试），不显示 needsLogin 的登录失效文案
      await screen.findByText('已取消')
      expect(screen.queryByText(/登录信息已过期/)).not.toBeInTheDocument()
      // 手动重试入口存在
      expect(screen.getByText('重试')).toBeInTheDocument()
    })

    it('恢复失败（无缓存）显示人机验证提示，不映射为登录失效', async () => {
      mockGetFavourites.mockRejectedValue(new Error('收藏夹请求遇到问题，请稍后重试'))
      render(<FavouritesPage />)

      await screen.findByText(/收藏夹请求遇到问题/)
      // 不应显示 needsLogin 状态（登录失效）
      expect(screen.queryByText(/登录信息已过期/)).not.toBeInTheDocument()
    })

    it('有缓存时取消恢复保留已显示的缓存内容', async () => {
      mockFavouritesStore.hasPage.mockReturnValue(true)
      // 第 1 页主动加载成功（带分页，使翻页按钮出现）
      mockGetFavourites.mockResolvedValueOnce({
        comics: [{ id: '1', title: 'Page1', url: '', coverUrl: '', source: 'test' }],
        pagination: { currentPage: 1, totalPages: 3, totalItems: 30 },
        needsLogin: false,
      }).mockRejectedValue(new Error('已取消'))
      // 第 2 页有缓存
      mockFavouritesStore.getPage.mockImplementation((_source: string, page: number) => {
        if (page !== 2) return undefined
        return {
          comics: [{ id: '2', title: 'Cached Favourite', url: '', coverUrl: '', source: 'test' }],
          pagination: { currentPage: 2, totalPages: 3, totalItems: 30 },
          currentPage: 2,
          downloadedStatus: {},
        }
      })

      render(<FavouritesPage />)
      await screen.findByText('Page1')
      // 翻到有缓存的第 2 页 → 缓存后台刷新被取消（reject）
      await userEvent.click((await screen.findAllByText('下一页'))[0])

      // 缓存的漫画仍显示（后台刷新失败不影响已显示内容）
      expect(await screen.findByText('Cached Favourite')).toBeInTheDocument()
      // 不应显示全局错误（缓存后台刷新失败静默吞掉）
      expect(screen.queryByText('已取消')).not.toBeInTheDocument()
    })
  })

  // ── jm-favourites-no-preload：JM 来源在收藏夹禁用相邻页预加载 ──────────────
  // JM 是唯一在收藏夹路径触发 Cloudflare 挑战的来源，预加载会放大请求把信任额度
  // 烧光。这组测试守护 `enabled: source !== 'jm' && ...` 这一行不被无声删除。
  describe('JM 收藏夹禁用相邻页预加载（jm-favourites-no-preload）', () => {
    // 用「来源 + 页码」键控 getFavourites：来源 jm 第 1 页返回多页结果（触发预加载
    // 候选页生成条件 totalPages > 1），其他页/来源返回空多页或单页。
    function mockJmMultiPage() {
      mockGetFavourites.mockImplementation((page: number, source?: string) => {
        if (source === 'jm' && page === 1) {
          return Promise.resolve({
            comics: [{ id: 'jm-1', title: 'JM Page1', url: '', coverUrl: '', source: 'jm' }],
            pagination: { currentPage: 1, totalPages: 5, totalItems: 50 },
            needsLogin: false,
          })
        }
        // jm 相邻页（2、3）若被预加载，会落到这里——测试通过断言「这里永不被调用」来证伪
        if (source === 'jm') {
          return Promise.resolve({
            comics: [{ id: `jm-${page}`, title: `JM Page${page}`, url: '', coverUrl: '', source: 'jm' }],
            pagination: { currentPage: page, totalPages: 5, totalItems: 50 },
            needsLogin: false,
          })
        }
        return Promise.resolve({ comics: [], pagination: { currentPage: 1, totalPages: 1, totalItems: 0 } })
      })
    }

    it('JM 来源加载第 1 页后不发起相邻页预加载请求', async () => {
      mockJmMultiPage()

      render(<FavouritesPage />)
      // 初始来源 hcomic，切到 jm
      await userEvent.click(screen.getByRole('button', { name: 'JM' }))
      // 等待 JM 第 1 页真实渲染（证明主动加载成功，source 已是 jm、多页 pagination 已就位）
      await screen.findByText('JM Page1')

      // 给预加载调度留出窗口（若 enabled 误为 true，page 2/3 会在此期间被请求）
      await new Promise((r) => setTimeout(r, 50))

      // 断言真实行为：JM 相邻页（2、3）永不被预加载调用
      const jmPreloadCalls = mockGetFavourites.mock.calls.filter(
        ([page, source]) => source === 'jm' && (page === 2 || page === 3),
      )
      expect(jmPreloadCalls).toHaveLength(0)
      // 对照：JM 第 1 页的主动加载确实发生了（证明断言不是因「JM 根本没加载」而空过）
      expect(mockGetFavourites).toHaveBeenCalledWith(1, 'jm', true)
    })

    it('非 JM 来源（hcomic）加载后仍正常预加载相邻页', async () => {
      // 对照测试：守护「禁用 JM 预加载」没有误伤其他来源
      mockGetFavourites.mockResolvedValue({
        comics: [{ id: 'h-1', title: 'HComic Page1', url: '', coverUrl: '', source: 'hcomic' }],
        pagination: { currentPage: 1, totalPages: 5, totalItems: 50 },
        needsLogin: false,
      })

      render(<FavouritesPage />)
      // hcomic 是默认来源，挂载即加载第 1 页
      await screen.findByText('HComic Page1')

      // hcomic 相邻页（page 2）必须被预加载（证明 enabled 对非 JM 仍为 true）
      await waitFor(() => {
        expect(mockGetFavourites).toHaveBeenCalledWith(2, 'hcomic', false)
      })
    })

    it('从 JM 切换到非 JM 来源后相邻页预加载恢复', async () => {
      mockGetFavourites.mockImplementation((page: number, source?: string) => {
        if (source === 'jm' && page === 1) {
          return Promise.resolve({
            comics: [{ id: 'jm-1', title: 'JM Page1', url: '', coverUrl: '', source: 'jm' }],
            pagination: { currentPage: 1, totalPages: 5, totalItems: 50 },
            needsLogin: false,
          })
        }
        if (source === 'hcomic' && page === 1) {
          return Promise.resolve({
            comics: [{ id: 'h-1', title: 'HComic Page1', url: '', coverUrl: '', source: 'hcomic' }],
            pagination: { currentPage: 1, totalPages: 5, totalItems: 50 },
            needsLogin: false,
          })
        }
        // hcomic 相邻页（2）若恢复预加载，会落到这里
        return Promise.resolve({ comics: [], pagination: { currentPage: 1, totalPages: 1, totalItems: 0 } })
      })

      render(<FavouritesPage />)
      // 先切到 JM（验证 JM 禁用），再切回 hcomic（验证恢复）
      await userEvent.click(screen.getByRole('button', { name: 'JM' }))
      await screen.findByText('JM Page1')

      await userEvent.click(screen.getByRole('button', { name: 'HComic' }))
      await screen.findByText('HComic Page1')

      // 切回 hcomic 后，相邻页（page 2）必须恢复预加载
      await waitFor(() => {
        expect(mockGetFavourites).toHaveBeenCalledWith(2, 'hcomic', false)
      })
    })

    it('从非 JM 来源切换到 JM 后停止相邻页预加载', async () => {
      mockGetFavourites.mockImplementation((page: number, source?: string) => {
        if (source === 'hcomic' && page === 1) {
          return Promise.resolve({
            comics: [{ id: 'h-1', title: 'HComic Page1', url: '', coverUrl: '', source: 'hcomic' }],
            pagination: { currentPage: 1, totalPages: 5, totalItems: 50 },
            needsLogin: false,
          })
        }
        if (source === 'jm' && page === 1) {
          return Promise.resolve({
            comics: [{ id: 'jm-1', title: 'JM Page1', url: '', coverUrl: '', source: 'jm' }],
            pagination: { currentPage: 1, totalPages: 5, totalItems: 50 },
            needsLogin: false,
          })
        }
        // jm 相邻页（2）若误启用预加载，会落到这里
        return Promise.resolve({ comics: [], pagination: { currentPage: 1, totalPages: 1, totalItems: 0 } })
      })

      render(<FavouritesPage />)
      // hcomic 是默认来源：先验证它确实预加载了相邻页（证明预加载机制本身在工作）
      await screen.findByText('HComic Page1')
      await waitFor(() => {
        expect(mockGetFavourites).toHaveBeenCalledWith(2, 'hcomic', false)
      })

      // 切换到 JM——验证切换生效（JM 第 1 页主动加载，allowInteractiveChallenge=true）
      await userEvent.click(screen.getByRole('button', { name: 'JM' }))
      await screen.findByText('JM Page1')
      expect(mockGetFavourites).toHaveBeenCalledWith(1, 'jm', true)

      // 给预加载调度留出窗口（若 enabled 误为 true，JM 相邻页会在此期间被请求）
      await new Promise((r) => setTimeout(r, 50))

      // 断言：切换到 JM 后，JM 的相邻页（2、3）禁止被预加载
      const jmPreloadCalls = mockGetFavourites.mock.calls.filter(
        ([page, source]) => source === 'jm' && (page === 2 || page === 3),
      )
      expect(jmPreloadCalls).toHaveLength(0)
    })
  })
})
