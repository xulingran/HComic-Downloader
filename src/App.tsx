import { useState, useEffect } from 'react'
import { useTheme } from './hooks/useTheme'
import { useSettingsStore } from './stores/useSettingsStore'
import { Sidebar } from './components/Sidebar'
import { SearchPage } from './pages/SearchPage'
import { DownloadPage } from './pages/DownloadPage'
import { FavouritesPage } from './pages/FavouritesPage'
import { SettingsPage } from './pages/SettingsPage'
import { StatisticsPage } from './pages/StatisticsPage'

function App() {
  const { setThemeMode } = useSettingsStore()
  useTheme()

  useEffect(() => {
    window.hcomic?.getConfig().then((result) => {
      const mode = result?.config?.themeMode
      if (mode === 'light' || mode === 'dark' || mode === 'auto') {
        setThemeMode(mode)
      }
    }).catch(() => { /* 配置加载失败保持默认主题 */ })
  }, [setThemeMode])

  const [activePage, setActivePage] = useState('search')

  const renderPage = () => {
    switch (activePage) {
      case 'search':
        return <SearchPage />
      case 'downloads':
        return <DownloadPage />
      case 'favourites':
        return <FavouritesPage onNavigateToSettings={() => setActivePage('settings')} />
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
