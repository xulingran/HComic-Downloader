import { useState, useEffect, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { TAB_ORDER, useTabPageVariants } from './lib/anim'
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
import { Toaster } from './components/common/Toaster'
import { FatalBanner } from './components/FatalBanner'
import { ComicInfoDrawer } from './components/ComicInfoDrawer'
import { ComicReaderModal } from './components/ComicReaderModal'
import { UpdateDialog } from './components/UpdateDialog'
import { useDrawerStore } from './stores/useDrawerStore'
import { useReaderStore } from './stores/useReaderStore'
import { useFatalErrorStore } from './stores/useFatalErrorStore'
import type { UpdateInfo, FatalErrorEvent } from '@shared/types'

function App() {
  const { sfwToastDismissed, dismissSfwToast } = useSettingsStore()
  const { setConfig } = useConfig()
  useTheme()
  const { setSfwMode, } = useInitConfig()
  const setFatalError = useFatalErrorStore((s) => s.setError)

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

  // 订阅主进程的致命错误（后端进程失败/重启超限），写入 store 驱动横幅
  useEffect(() => {
    const unsubscribe = window.hcomic?.onFatalError((data: FatalErrorEvent) => {
      setFatalError(data)
    })
    return () => { unsubscribe?.() }
  }, [setFatalError])

  const [activePage, setActivePage] = useState('search')
  const [scrollTarget, setScrollTarget] = useState<string | null>(null)
  const [direction, setDirection] = useState(0)
  const { pendingSearch } = useDrawerStore()
  const { readerComic, closeReader } = useReaderStore()
  const tabVariants = useTabPageVariants()

  const handlePageChange = useCallback((page: string) => {
    const oldIndex = TAB_ORDER.indexOf(activePage as typeof TAB_ORDER[number])
    const newIndex = TAB_ORDER.indexOf(page as typeof TAB_ORDER[number])
    setDirection(oldIndex === -1 || page === activePage ? 0 : newIndex > oldIndex ? 1 : -1)
    setActivePage(page)
  }, [activePage])

  useEffect(() => {
    if (pendingSearch && activePage !== 'search') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      handlePageChange('search')
    }
  }, [pendingSearch, activePage, handlePageChange])

  const renderPage = () => {
    switch (activePage) {
      case 'search':
        return <SearchPage onNavigateToSettings={() => { handlePageChange('settings'); setScrollTarget('login') }} />
      case 'downloads':
        return <DownloadPage />
      case 'favourites':
        return <FavouritesPage onNavigateToSettings={() => { handlePageChange('settings'); setScrollTarget('login') }} />
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
      {/* SFW 提示：交互型常驻 Toast（带 action），保留原有交互 */}
      <Toast
        message="当前处于 SFW 模式，封面已隐藏"
        actionLabel="关闭 SFW"
        onAction={handleDisableSfw}
        onDismiss={handleDismissToast}
        visible={showSfwToast && !sfwToastDismissed}
      />
      {/* 瞬态操作反馈 Toast（错误/成功提示，自动消失） */}
      <Toaster />
      <Sidebar activePage={activePage} onPageChange={handlePageChange} />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 致命错误横幅：位于内容区顶部，不阻塞操作 */}
        <FatalBanner />
        <main className="flex-1 relative px-6 py-3">
          <AnimatePresence custom={direction}>
            <motion.div
              key={activePage}
              variants={tabVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              custom={direction}
              className="absolute inset-0 overflow-auto"
            >
              {renderPage()}
            </motion.div>
          </AnimatePresence>
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
