import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

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
      <button onClick={() => onPageChange('settings')}>Settings</button>
      <button onClick={() => onPageChange('statistics')}>Statistics</button>
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

vi.mock('@/pages/StatisticsPage', () => ({
  StatisticsPage: () => <div data-testid="statistics-page">Statistics Page</div>
}))

// Import App after all mocks
import App from '@/App'

describe('App', () => {
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

    expect(screen.getByTestId('download-page')).toBeInTheDocument()
    expect(screen.getByTestId('active-page')).toHaveTextContent('downloads')
  })

  it('switches to favourites page when Favourites button clicked', async () => {
    render(<App />)

    await userEvent.click(screen.getByText('Favourites'))

    expect(screen.getByTestId('favourites-page')).toBeInTheDocument()
    expect(screen.getByTestId('active-page')).toHaveTextContent('favourites')
  })

  it('switches to settings page when Settings button clicked', async () => {
    render(<App />)

    await userEvent.click(screen.getByText('Settings'))

    expect(screen.getByTestId('settings-page')).toBeInTheDocument()
    expect(screen.getByTestId('active-page')).toHaveTextContent('settings')
  })

  it('switches to statistics page when Statistics button clicked', async () => {
    render(<App />)

    await userEvent.click(screen.getByText('Statistics'))

    expect(screen.getByTestId('statistics-page')).toBeInTheDocument()
    expect(screen.getByTestId('active-page')).toHaveTextContent('statistics')
  })

  it('can switch back to search from another page', async () => {
    render(<App />)

    await userEvent.click(screen.getByText('Settings'))
    expect(screen.getByTestId('settings-page')).toBeInTheDocument()

    await userEvent.click(screen.getByText('Search'))
    expect(screen.getByTestId('search-page')).toBeInTheDocument()
    expect(screen.getByTestId('active-page')).toHaveTextContent('search')
  })
})
