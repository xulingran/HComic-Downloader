import { useState, useEffect, useCallback } from 'react'
import { useTheme } from './hooks/useTheme'
import { useSettingsStore } from './stores/useSettingsStore'
import { useConfig } from './hooks/useIpc'
import { useInitConfig } from './hooks/useInitConfig'
import { Sidebar } from './components/Sidebar'
import { SearchPage } from './pages/SearchPage'
import { DownloadPage } from './pages/DownloadPage'
import { FavouritesPage } from './pages/FavouritesPage'
import { HistoryPage } from './pages/HistoryPage'
import { SettingsPage } from './pages/SettingsPage'
import { ToolboxPage } from './pages/ToolboxPage'
import { AboutPage } from './pages/AboutPage'
import { Toast } from './components/common/Toast'
import { ComicInfoDrawer } from './components/ComicInfoDrawer'
import { ComicReaderModal } from './components/ComicReaderModal'
import { UpdateDialog } from './components/UpdateDialog'
import { useDrawerStore } from './stores/useDrawerStore'
import { useReaderStore } from './stores/useReaderStore'
import type { UpdateInfo } from '@shared/types'

function App() {
  const { sfwToastDismissed, dismissSfwToast } = useSettingsStore()
  const { setConfig } = useConfig()
  useTheme()
  const { setSfwMode, } = useInitConfig()

  const [showSfwToast, setShowSfwToast] = useState(true)

  const handleDisableSfw = useCallback(() => {
    setSfwMode(false)
    setConfig('sfwMode', false).catch(() => {})
    setShowSfwToast(false)
    dismissSfwToast()
  }, [setSfwMode, setConfig, dismissSfwToast])

  const handleDismissToast = useCallback(() => {
    setShowSfwToast(false)
    dismissSfwToast()
  }, [dismissSfwToast])

  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)

  useEffect(() => {
    const unsubscribe = window.hcomic?.onUpdateAvailable((info: UpdateInfo) => {
      setUpdateInfo(info)
    })
    return () => { unsubscribe?.() }
  }, [])

  const [activePage, setActivePage] = useState('search')
  const [scrollTarget, setScrollTarget] = useState<string | null>(null)
  const { pendingSearch } = useDrawerStore()
  const { readerComic, closeReader } = useReaderStore()

  useEffect(() => {
    if (pendingSearch && activePage !== 'search') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActivePage('search')
    }
  }, [pendingSearch, activePage])

  const renderPage = () => {
    switch (activePage) {
      case 'search':
        return <SearchPage onNavigateToSettings={() => { setActivePage('settings'); setScrollTarget('login') }} />
      case 'downloads':
        return <DownloadPage />
      case 'favourites':
        return <FavouritesPage onNavigateToSettings={() => { setActivePage('settings'); setScrollTarget('login') }} />
      case 'history':
        return <HistoryPage />
      case 'settings':
        return <SettingsPage scrollTarget={scrollTarget} onScrollDone={() => setScrollTarget(null)} />
      case 'toolbox':
        return <ToolboxPage />
      case 'about':
        return <AboutPage />
      default:
        return <div className="text-[var(--text-primary)]">Unknown page</div>
    }
  }

  return (
    <div className="flex h-screen bg-[var(--bg-secondary)]">
      <Toast
        message="当前处于 SFW 模式，封面已隐藏"
        actionLabel="关闭 SFW"
        onAction={handleDisableSfw}
        onDismiss={handleDismissToast}
        visible={showSfwToast && !sfwToastDismissed}
      />
      <Sidebar activePage={activePage} onPageChange={setActivePage} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-auto px-6 py-3">
          {renderPage()}
        </main>
      </div>
      <ComicInfoDrawer />
      <ComicReaderModal
        comic={readerComic}
        open={!!readerComic}
        onClose={closeReader}
      />
      {updateInfo && (
        <UpdateDialog
          info={updateInfo}
          onClose={() => setUpdateInfo(null)}
        />
      )}
    </div>
  )
}

export default App
