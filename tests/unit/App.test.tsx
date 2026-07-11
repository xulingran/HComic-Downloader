import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useDrawerStore } from '@/stores/useDrawerStore'

const { mockGetConfig, mockSetConfig, mockPrefetch, enterStartSpy, enterTargetSpy, exitTargetSpy, reducedMotionValue } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockSetConfig: vi.fn(),
  mockPrefetch: vi.fn().mockResolvedValue(undefined),
  enterStartSpy: vi.fn(),
  enterTargetSpy: vi.fn(),
  exitTargetSpy: vi.fn(),
  // 可变标志：测试用例切换后，useReducedMotionPreference 返回此值，驱动 reduced-motion 分支。
  reducedMotionValue: { current: false }
}))

// 捕获 fade-through 的阶段目标，并让 reduced-motion 偏好可控。
vi.mock('@/lib/anim', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/anim')>()
  return {
    ...actual,
    useReducedMotionPreference: () => reducedMotionValue.current,
    getTabPageEnterStart: (dir: number) => {
      const target = actual.getTabPageEnterStart(dir)
      enterStartSpy(dir, target)
      return target
    },
    getTabPageEnterTarget: () => {
      const target = actual.getTabPageEnterTarget()
      enterTargetSpy(target)
      return target
    },
    getTabPageExitTarget: (dir: number) => {
      const target = actual.getTabPageExitTarget(dir)
      exitTargetSpy(dir, target)
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
  SearchPage: ({ onNavigateToSettings }: { onNavigateToSettings: () => void }) => (
    <div data-testid="search-page">Search Page<button onClick={onNavigateToSettings}>Go Settings</button></div>
  ),
  default: () => <div data-testid="search-page">Search Page</div>
}))

vi.mock('@/pages/DownloadPage', async () => {
  const { useState } = await import('react')
  const MockDownloadPage = () => {
    const [count, setCount] = useState(0)
    return (
      <div data-testid="download-page">
        Download Page
        <output data-testid="download-local-state">{count}</output>
        <button onClick={() => setCount((value) => value + 1)}>Increment Download State</button>
      </div>
    )
  }
  return { DownloadPage: MockDownloadPage, default: MockDownloadPage }
})

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

function getTabPage(page: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-tab-page="${page}"]`)
  if (!element) throw new Error(`Tab page wrapper not found: ${page}`)
  return element
}

function expectOnlyDisplayed(page: string): void {
  const displayed = [...document.querySelectorAll<HTMLElement>('[data-tab-visible="true"]')]
  expect(displayed).toHaveLength(1)
  expect(displayed[0]).toHaveAttribute('data-tab-page', page)
}

async function waitForVisiblePage(page: string): Promise<void> {
  await waitFor(() => {
    expect(getTabPage(page)).toHaveAttribute('data-tab-phase', 'visible')
    expectOnlyDisplayed(page)
  })
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reducedMotionValue.current = false
    useDrawerStore.setState({ pendingSearch: null })
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
    it('切走后页面实例、局部状态与滚动位置均保留', async () => {
      const user = userEvent.setup()
      render(<App />)

      // 首屏只有 search
      expect(screen.getByTestId('search-page')).toBeInTheDocument()

      // 切到 downloads（首次进入，走 deferred mount）
      await user.click(screen.getByText('Downloads'))
      await waitForVisiblePage('downloads')
      await user.click(screen.getByText('Increment Download State'))
      getTabPage('downloads').scrollTop = 137

      // 切回 search
      await user.click(screen.getByText('Search'))
      await waitForVisiblePage('search')

      // keep-alive：downloads 页元素应仍在 DOM（display:none 隐藏但未卸载）
      expect(screen.getByTestId('download-page')).toBeInTheDocument()
      expect(screen.getByTestId('download-local-state')).toHaveTextContent('1')
      expect(getTabPage('downloads').scrollTop).toBe(137)

      await user.click(screen.getByText('Downloads'))
      await waitForVisiblePage('downloads')
      expect(screen.getByTestId('download-local-state')).toHaveTextContent('1')
      expect(getTabPage('downloads').scrollTop).toBe(137)
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

  describe('tab fade-through（fix-tab-content-overlap）', () => {
    beforeEach(() => {
      enterStartSpy.mockClear()
      enterTargetSpy.mockClear()
      exitTargetSpy.mockClear()
    })

    it('退出阶段仅旧页可见，进入阶段仅新页可见', async () => {
      const user = userEvent.setup()
      render(<App />)

      await user.click(screen.getByText('Downloads'))
      expect(getTabPage('search')).toHaveAttribute('data-tab-phase', 'exiting')
      expect(getTabPage('downloads')).toHaveAttribute('data-tab-phase', 'hidden')
      expectOnlyDisplayed('search')

      await waitFor(() => {
        expect(getTabPage('downloads')).toHaveAttribute('data-tab-phase', 'entering')
        expectOnlyDisplayed('downloads')
      })

      await waitForVisiblePage('downloads')
    })

    it('首次访问与切回已访问页面都播放方向感知的进入动画', async () => {
      const user = userEvent.setup()
      render(<App />)

      await user.click(screen.getByText('Downloads'))
      await waitForVisiblePage('downloads')
      expect(enterStartSpy).toHaveBeenLastCalledWith(1, { x: '8%', opacity: 0 })

      enterStartSpy.mockClear()
      await user.click(screen.getByText('Search'))
      await waitForVisiblePage('search')
      expect(enterStartSpy).toHaveBeenLastCalledWith(-1, { x: '-8%', opacity: 0 })
    })

    it('左右导航使用正确的退出方向', async () => {
      const user = userEvent.setup()
      render(<App />)

      await user.click(screen.getByText('Downloads'))
      expect(exitTargetSpy).toHaveBeenLastCalledWith(1, expect.objectContaining({ x: '-8%', opacity: 0 }))
      await waitForVisiblePage('downloads')

      exitTargetSpy.mockClear()
      await user.click(screen.getByText('Search'))
      expect(exitTargetSpy).toHaveBeenLastCalledWith(-1, expect.objectContaining({ x: '8%', opacity: 0 }))
      await waitForVisiblePage('search')
    })

    it('同页点击不启动动画', async () => {
      const user = userEvent.setup()
      render(<App />)

      await user.click(screen.getByText('Search'))
      expect(getTabPage('search')).toHaveAttribute('data-tab-phase', 'visible')
      expect(exitTargetSpy).not.toHaveBeenCalled()
      expect(enterTargetSpy).not.toHaveBeenCalled()
    })

    it('退出阶段连续点击只进入最新目标', async () => {
      render(<App />)

      fireEvent.click(screen.getByText('Downloads'))
      expect(getTabPage('search')).toHaveAttribute('data-tab-phase', 'exiting')
      fireEvent.click(screen.getByText('Favourites'))

      expect(screen.getByTestId('active-page')).toHaveTextContent('favourites')
      expectOnlyDisplayed('search')
      await waitForVisiblePage('favourites')
      expect(getTabPage('downloads')).toHaveAttribute('data-tab-phase', 'hidden')
    })

    it('进入阶段收到新目标时完成当前半阶段后继续，始终只有一页可见', async () => {
      const user = userEvent.setup()
      render(<App />)

      await user.click(screen.getByText('Downloads'))
      await waitFor(() => expect(getTabPage('downloads')).toHaveAttribute('data-tab-phase', 'entering'))
      await user.click(screen.getByText('Favourites'))

      expectOnlyDisplayed('downloads')
      await waitForVisiblePage('favourites')
      expectOnlyDisplayed('favourites')
    })

    it('reduced-motion 瞬时切换且不调用动画目标', async () => {
      reducedMotionValue.current = true
      const user = userEvent.setup()
      render(<App />)

      await user.click(screen.getByText('Downloads'))
      expect(getTabPage('downloads')).toHaveAttribute('data-tab-phase', 'visible')
      expectOnlyDisplayed('downloads')
      expect(exitTargetSpy).not.toHaveBeenCalled()
      expect(enterTargetSpy).not.toHaveBeenCalled()
    })

    it('程序化跳转与侧边栏点击共用过渡状态机', async () => {
      const user = userEvent.setup()
      render(<App />)

      await user.click(screen.getByText('Go Settings'))
      expect(screen.getByTestId('active-page')).toHaveTextContent('settings')
      await waitForVisiblePage('settings')

      act(() => useDrawerStore.getState().setPendingSearch('query', 'name'))
      await waitFor(() => {
        expect(screen.getByTestId('active-page')).toHaveTextContent('search')
      })
      await waitForVisiblePage('search')
    })
  })
})
