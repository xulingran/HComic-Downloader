import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSettingsStore } from '@/stores/useSettingsStore'

const { mockGetConfig, mockSetConfig, mockPrefetch, enterTargetSpy, exitTargetSpy, reducedMotionValue } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockSetConfig: vi.fn(),
  mockPrefetch: vi.fn().mockResolvedValue(undefined),
  // 捕获 KeepAlivePage 调用的进入/退出动画目标函数。
  // KeepAlivePage 在 isActive 切换时调用 getTabEnterTarget/getTabExitTarget 获取目标对象，
  // 再交给真实 controls.start() 执行。spy 这些调用可验证「切回重播」与「方向参数」真实行为。
  enterTargetSpy: vi.fn(),
  exitTargetSpy: vi.fn(),
  // 可变标志：测试用例切换后，useReducedMotionPreference 返回此值，驱动 reduced-motion 分支。
  reducedMotionValue: { current: false }
}))

// 拦截 @/lib/anim 的进入/退出目标函数为 spy + useReducedMotionPreference 为可控 flag，
// 其余导出（TAB_ORDER、useTabPageVariants）保留真实实现。real controls.start() 消费 spy 返回的目标对象。
vi.mock('@/lib/anim', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/anim')>()
  return {
    ...actual,
    useReducedMotionPreference: () => reducedMotionValue.current,
    getTabEnterTarget: (dir: number, reduceMotion: boolean) => {
      const target = reduceMotion
        ? { opacity: 1, transition: { duration: 0.15 } }
        : { x: 0, opacity: 1, transition: actual.smoothTransition }
      enterTargetSpy(dir, reduceMotion, target)
      return target
    },
    getTabExitTarget: (dir: number, reduceMotion: boolean) => {
      const target = reduceMotion
        ? { opacity: 0, transition: { duration: 0.15 } }
        : { x: dir > 0 ? '-8%' : dir < 0 ? '8%' : 0, opacity: 0, transition: actual.smoothTransition }
      exitTargetSpy(dir, reduceMotion, target)
      return target
    },
  }
})

vi.mock('@/hooks/useIpc', () => ({
  useConfig: vi.fn().mockReturnValue({
    getConfig: mockGetConfig,
    setConfig: mockSetConfig,
    openDownloadDir: vi.fn().mockResolvedValue({ success: true })
  }),
  useAddToFavourites: vi.fn().mockReturnValue({
    addToFavourites: vi.fn().mockResolvedValue({ success: true })
  }),
  useCheckFavourite: vi.fn().mockReturnValue({
    checkFavourite: vi.fn().mockResolvedValue({ isFavourited: false })
  }),
  useRemoveFromFavourites: vi.fn().mockReturnValue({
    removeFromFavourites: vi.fn().mockResolvedValue({ success: true })
  }),
  useHistory: vi.fn().mockReturnValue({
    getHistory: vi.fn().mockResolvedValue({ items: [], pagination: { currentPage: 1, totalPages: 1, totalItems: 0 } }),
    addHistory: vi.fn().mockResolvedValue({ success: true }),
    deleteHistory: vi.fn().mockResolvedValue({ success: true }),
    clearHistory: vi.fn().mockResolvedValue({ success: true })
  }),
  useComicDetail: vi.fn().mockReturnValue({
    getComicDetail: vi.fn().mockResolvedValue({ comic: null })
  }),
  useFavouriteTags: vi.fn().mockReturnValue({
    getFavouriteTags: vi.fn().mockResolvedValue({ tags: [] }),
    clearFavouriteTags: vi.fn().mockResolvedValue({ success: true }),
    removeFavouriteTag: vi.fn().mockResolvedValue({ success: true })
  }),
  useLibrary: vi.fn().mockReturnValue({
    detail: vi.fn(),
    pageManifest: vi.fn(),
    getPage: vi.fn(),
    saveReadingProgress: vi.fn()
  })
}))

vi.mock('@/hooks/useTheme', () => ({
  useTheme: vi.fn().mockReturnValue({ themeMode: 'auto', setThemeMode: vi.fn() })
}))

vi.mock('@/lib/prefetch', () => ({
  prefetchHighFrequencyChunks: mockPrefetch
}))

vi.mock('@/components/Sidebar', () => ({
  Sidebar: ({ activePage, onPageChange }: { activePage: string; onPageChange: (page: string) => void }) => (
    <div data-testid="sidebar">
      <span data-testid="active-page">{activePage}</span>
      <button onClick={() => onPageChange('search')}>Search</button>
      <button onClick={() => onPageChange('downloads')}>Downloads</button>
      <button onClick={() => onPageChange('favourites')}>Favourites</button>
      <button onClick={() => onPageChange('history')}>History</button>
      <button onClick={() => onPageChange('toolbox')}>Toolbox</button>
      <button onClick={() => onPageChange('settings')}>Settings</button>
    </div>
  )
}))

vi.mock('@/pages/SearchPage', () => ({
  SearchPage: () => <div data-testid="search-page">Search Page</div>,
  default: () => <div data-testid="search-page">Search Page</div>
}))

vi.mock('@/pages/DownloadPage', () => ({
  DownloadPage: () => <div data-testid="download-page">Download Page</div>,
  default: () => <div data-testid="download-page">Download Page</div>
}))

vi.mock('@/pages/FavouritesPage', () => ({
  FavouritesPage: () => <div data-testid="favourites-page">Favourites Page</div>,
  default: () => <div data-testid="favourites-page">Favourites Page</div>
}))

vi.mock('@/pages/SettingsPage', () => ({
  SettingsPage: () => <div data-testid="settings-page">Settings Page</div>,
  default: () => <div data-testid="settings-page">Settings Page</div>
}))

vi.mock('@/pages/ToolboxPage', () => ({
  ToolboxPage: () => <div data-testid="toolbox-page">Toolbox Page</div>,
  default: () => <div data-testid="toolbox-page">Toolbox Page</div>
}))

vi.mock('@/pages/HistoryPage', () => ({
  HistoryPage: () => <div data-testid="history-page">History Page</div>,
  default: () => <div data-testid="history-page">History Page</div>
}))

// Import App after all mocks
import App from '@/App'

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reducedMotionValue.current = false
    useSettingsStore.setState({
      themeMode: 'auto',
      cardStyle: 'cover',
      sfwMode: false,
      sfwToastDismissed: false
    })
    mockGetConfig.mockResolvedValue({ config: { themeMode: 'auto' } })
    mockSetConfig.mockResolvedValue({ success: true })
  })

  it('renders with sidebar', () => {
    render(<App />)

    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
  })

  it('renders search page by default', () => {
    render(<App />)

    expect(screen.getByTestId('search-page')).toBeInTheDocument()
  })

  it('shows search as active page by default', () => {
    render(<App />)

    expect(screen.getByTestId('active-page')).toHaveTextContent('search')
  })

  it('switches to downloads page when Downloads button clicked', async () => {
    render(<App />)

    await userEvent.click(screen.getByText('Downloads'))

    await waitFor(() => {
      expect(screen.getByTestId('download-page')).toBeInTheDocument()
    })
    expect(screen.getByTestId('active-page')).toHaveTextContent('downloads')
  })

  it('switches to favourites page when Favourites button clicked', async () => {
    render(<App />)

    await userEvent.click(screen.getByText('Favourites'))

    await waitFor(() => {
      expect(screen.getByTestId('favourites-page')).toBeInTheDocument()
    })
    expect(screen.getByTestId('active-page')).toHaveTextContent('favourites')
  })

  it('switches to settings page when Settings button clicked', async () => {
    render(<App />)

    await userEvent.click(screen.getByText('Settings'))

    await waitFor(() => {
      expect(screen.getByTestId('settings-page')).toBeInTheDocument()
    })
    expect(screen.getByTestId('active-page')).toHaveTextContent('settings')
  })

  it('can switch back to search from another page', async () => {
    render(<App />)

    await userEvent.click(screen.getByText('Settings'))
    await waitFor(() => {
      expect(screen.getByTestId('settings-page')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText('Search'))
    await waitFor(() => {
      expect(screen.getByTestId('search-page')).toBeInTheDocument()
    })
    expect(screen.getByTestId('active-page')).toHaveTextContent('search')
  })

  it('shows SFW toast on startup', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('当前处于 SFW 模式，封面已隐藏')).toBeInTheDocument()
    })

    expect(screen.getByText('关闭 SFW')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument()
  })

  it('disables SFW when close SFW button is clicked', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('关闭 SFW')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText('关闭 SFW'))

    await waitFor(() => {
      expect(mockSetConfig).toHaveBeenCalledWith('sfwMode', false)
    })
  })

  it('dismisses toast when close button is clicked', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '关闭' }))

    await waitFor(() => {
      expect(screen.queryByText('当前处于 SFW 模式，封面已隐藏')).toBeNull()
    })
  })

  it('idle prefetch 在应用就绪后触发一次高频 chunk 预热', async () => {
    // mockGetConfig resolve → configLoaded true → markStartupReady → done=true
    // → prefetch effect 在 startupProgress.done 为 true 时触发
    render(<App />)

    await waitFor(() => {
      expect(mockPrefetch).toHaveBeenCalledTimes(1)
    })
  })

  it('switches to toolbox page when Toolbox button clicked', async () => {
    render(<App />)

    await userEvent.click(screen.getByText('Toolbox'))

    await waitFor(() => {
      expect(screen.getByTestId('toolbox-page')).toBeInTheDocument()
    })
    expect(screen.getByTestId('active-page')).toHaveTextContent('toolbox')
  })

  describe('keep-alive', () => {
    it('切走后页面实例保留在 DOM（display:none），切回复用', async () => {
      render(<App />)

      // 首屏只有 search
      expect(screen.getByTestId('search-page')).toBeInTheDocument()

      // 切到 downloads（首次进入，走 deferred mount）
      await userEvent.click(screen.getByText('Downloads'))
      await waitFor(() => {
        expect(screen.getByTestId('download-page')).toBeInTheDocument()
      })

      // 切回 search
      await userEvent.click(screen.getByText('Search'))
      await waitFor(() => {
        expect(screen.getByTestId('active-page')).toHaveTextContent('search')
      })

      // keep-alive：downloads 页元素应仍在 DOM（display:none 隐藏但未卸载）
      expect(screen.getByTestId('download-page')).toBeInTheDocument()
      // search 页可见
      expect(screen.getByTestId('search-page')).toBeInTheDocument()
    })

    it('首次进入非首屏页面直接渲染真实内容（无骨架闪现）', async () => {
      render(<App />)

      // 切到 settings（非首屏）——无 deferred mount，直接渲染真实内容
      await userEvent.click(screen.getByText('Settings'))

      // 真实内容应立即可见（无骨架兜底阶段）
      await waitFor(() => {
        expect(screen.getByTestId('settings-page')).toBeInTheDocument()
      })
      expect(screen.getByTestId('active-page')).toHaveTextContent('settings')
    })
  })

  describe('tab 切换动画重播（fix-tab-switch-animation）', () => {
    beforeEach(() => {
      enterTargetSpy.mockClear()
      exitTargetSpy.mockClear()
    })

    it('切回已访问页面重播进入动画（而非瞬间显示）', async () => {
      const user = userEvent.setup()
      render(<App />)

      // 注：首屏 mount 与懒创建首访不播进入动画（防 controls 绑定时序竞态白屏），
      // 故首次进入 downloads 不触发 enterTarget；只有切回已存活页面才播进入动画。

      // 切到 downloads（懒创建首访：无进入动画，但 search 退出动画触发）
      await user.click(screen.getByText('Downloads'))
      await waitFor(() => {
        expect(screen.getByTestId('active-page')).toHaveTextContent('downloads')
      })
      // 此时 enterTarget 尚未被调用（downloads 是首次 mount）
      expect(enterTargetSpy).not.toHaveBeenCalled()

      // 切回 search（search 实例已存活，必须重播进入动画）
      await user.click(screen.getByText('Search'))
      await waitFor(() => {
        expect(screen.getByTestId('active-page')).toHaveTextContent('search')
      })

      // 关键断言：切回后进入目标函数被调用，证明切回已存活页面重播了进入动画。
      expect(enterTargetSpy).toHaveBeenCalled()
      // 最后一次进入调用的 dir 参数应为 -1（search<downloads，向左导航）
      const lastEnterCall = enterTargetSpy.mock.calls[enterTargetSpy.mock.calls.length - 1]
      expect(lastEnterCall[0]).toBe(-1)
    })

    it('连续多次切换每次都触发动画（禁止仅首次触发）', async () => {
      const user = userEvent.setup()
      render(<App />)

      // search → downloads → search → downloads，记录每次切换后的进入目标调用次数
      await user.click(screen.getByText('Downloads'))
      await waitFor(() => {
        expect(screen.getByTestId('active-page')).toHaveTextContent('downloads')
      })
      const afterFirst = enterTargetSpy.mock.calls.length

      await user.click(screen.getByText('Search'))
      await waitFor(() => {
        expect(screen.getByTestId('active-page')).toHaveTextContent('search')
      })
      expect(enterTargetSpy.mock.calls.length).toBeGreaterThan(afterFirst)
      const afterSecond = enterTargetSpy.mock.calls.length

      await user.click(screen.getByText('Downloads'))
      await waitFor(() => {
        expect(screen.getByTestId('active-page')).toHaveTextContent('downloads')
      })
      // 第三次切换（downloads 实例已存活）仍触发进入动画，证明非仅首次触发。
      expect(enterTargetSpy.mock.calls.length).toBeGreaterThan(afterSecond)
    })

    it('方向感知：向右导航时退出目标 x=-8%', async () => {
      const user = userEvent.setup()
      render(<App />)

      // search(index 0) → downloads(index 1)，direction=+1（向右导航）
      await user.click(screen.getByText('Downloads'))
      await waitFor(() => {
        expect(screen.getByTestId('active-page')).toHaveTextContent('downloads')
      })

      // search 退出动画：direction=+1 → 退出目标函数收到 dir=1，目标 x='-8%'
      const exitCalls = exitTargetSpy.mock.calls
      expect(exitCalls.length).toBeGreaterThan(0)
      expect(exitCalls[exitCalls.length - 1][0]).toBe(1) // dir=+1
      expect(exitCalls[exitCalls.length - 1][2]).toMatchObject({ x: '-8%', opacity: 0 })
    })

    it('方向感知：向左导航时退出目标 x=8%', async () => {
      const user = userEvent.setup()
      render(<App />)

      // 先切到 downloads，再切回 search（direction=-1，向左导航）
      await user.click(screen.getByText('Downloads'))
      await waitFor(() => {
        expect(screen.getByTestId('active-page')).toHaveTextContent('downloads')
      })
      exitTargetSpy.mockClear()

      await user.click(screen.getByText('Search'))
      await waitFor(() => {
        expect(screen.getByTestId('active-page')).toHaveTextContent('search')
      })

      // downloads 退出动画：direction=-1 → 退出目标函数收到 dir=-1，目标 x='8%'
      const exitCalls = exitTargetSpy.mock.calls
      expect(exitCalls.length).toBeGreaterThan(0)
      expect(exitCalls[exitCalls.length - 1][0]).toBe(-1) // dir=-1
      expect(exitCalls[exitCalls.length - 1][2]).toMatchObject({ x: '8%', opacity: 0 })
    })

    it('reduced-motion 下进入动画用纯 opacity 目标（无 x 位移）', async () => {
      // 开启 reduced-motion，验证切回已存活页面时进入目标函数 reduceMotion=true，
      // 且返回的目标无 x 字段（纯 opacity crossfade）。
      reducedMotionValue.current = true
      const user = userEvent.setup()
      render(<App />)

      // downloads 首访（懒创建，无进入动画）→ search 切回（触发进入动画，reduceMotion=true）
      await user.click(screen.getByText('Downloads'))
      await waitFor(() => {
        expect(screen.getByTestId('active-page')).toHaveTextContent('downloads')
      })

      await user.click(screen.getByText('Search'))
      await waitFor(() => {
        expect(screen.getByTestId('active-page')).toHaveTextContent('search')
      })

      // 进入目标应 reduceMotion=true 且无 x 字段（仅 opacity:1）
      expect(enterTargetSpy).toHaveBeenCalled()
      const enterCalls = enterTargetSpy.mock.calls
      const lastEnter = enterCalls[enterCalls.length - 1]
      expect(lastEnter[1]).toBe(true) // reduceMotion
      expect(lastEnter[2]).toMatchObject({ opacity: 1 })
      expect(lastEnter[2].x).toBeUndefined()
    })
  })
})
