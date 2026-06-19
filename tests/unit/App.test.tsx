import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSettingsStore } from '@/stores/useSettingsStore'

const { mockGetConfig, mockSetConfig } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockSetConfig: vi.fn()
}))

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
  })
}))

vi.mock('@/hooks/useTheme', () => ({
  useTheme: vi.fn().mockReturnValue({ themeMode: 'auto', setThemeMode: vi.fn() })
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
  SearchPage: () => <div data-testid="search-page">Search Page</div>
}))

vi.mock('@/pages/DownloadPage', () => ({
  DownloadPage: () => <div data-testid="download-page">Download Page</div>
}))

vi.mock('@/pages/FavouritesPage', () => ({
  FavouritesPage: () => <div data-testid="favourites-page">Favourites Page</div>
}))

vi.mock('@/pages/SettingsPage', () => ({
  SettingsPage: () => <div data-testid="settings-page">Settings Page</div>
}))

vi.mock('@/pages/ToolboxPage', () => ({
  ToolboxPage: () => <div data-testid="toolbox-page">Toolbox Page</div>
}))

vi.mock('@/pages/HistoryPage', () => ({
  HistoryPage: () => <div data-testid="history-page">History Page</div>
}))

// Import App after all mocks
import App from '@/App'

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('switches to toolbox page when Toolbox button clicked', async () => {
    render(<App />)

    await userEvent.click(screen.getByText('Toolbox'))

    await waitFor(() => {
      expect(screen.getByTestId('toolbox-page')).toBeInTheDocument()
    })
    expect(screen.getByTestId('active-page')).toHaveTextContent('toolbox')
  })
})
