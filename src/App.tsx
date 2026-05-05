import { useState } from 'react'
import { useTheme } from './hooks/useTheme'
import { Sidebar } from './components/Sidebar'
import { SearchPage } from './pages/SearchPage'
import { DownloadPage } from './pages/DownloadPage'
import { FavouritesPage } from './pages/FavouritesPage'
import { SettingsPage } from './pages/SettingsPage'
import { StatisticsPage } from './pages/StatisticsPage'

function App() {
  useTheme()
  const [activePage, setActivePage] = useState('search')

  const renderPage = () => {
    switch (activePage) {
      case 'search':
        return <SearchPage />
      case 'downloads':
        return <DownloadPage />
      case 'favourites':
        return <FavouritesPage />
      case 'settings':
        return <SettingsPage />
      case 'statistics':
        return <StatisticsPage />
      default:
        return <div className="text-[var(--text-primary)]">Unknown page</div>
    }
  }

  return (
    <div className="flex h-screen bg-[var(--bg-secondary)]">
      <Sidebar activePage={activePage} onPageChange={setActivePage} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-auto p-6">
          {renderPage()}
        </main>
      </div>
    </div>
  )
}

export default App
