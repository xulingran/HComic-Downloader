import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { TAB_ORDER, useTabPageVariants } from './lib/anim'
import { useTheme } from './hooks/useTheme'
import { useSettingsStore } from './stores/useSettingsStore'
import { useConfig } from './hooks/useIpc'
import { useInitConfig } from './hooks/useInitConfig'
import { useStartupProgress, markStartupReady } from './hooks/useStartupProgress'
import { Sidebar } from './components/Sidebar'
import { SearchPage } from './pages/SearchPage'
import { Toast } from './components/common/Toast'
import { Toaster } from './components/common/Toaster'
import { FatalBanner } from './components/FatalBanner'
import { StartupScreen } from './components/StartupScreen'
import { useDrawerStore } from './stores/useDrawerStore'
import { useReaderStore } from './stores/useReaderStore'
import { useFatalErrorStore } from './stores/useFatalErrorStore'
import type { UpdateInfo, FatalErrorEvent } from '@shared/types'

// 代码分割 —— 非首屏页面和模态框（页面均为 named export，需要模块重导出为 default）
const DownloadPage = lazy(() => import('./pages/DownloadPage').then(m => ({ default: m.DownloadPage })))
const FavouritesPage = lazy(() => import('./pages/FavouritesPage').then(m => ({ default: m.FavouritesPage })))
const HistoryPage = lazy(() => import('./pages/HistoryPage').then(m => ({ default: m.HistoryPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })))
const ToolboxPage = lazy(() => import('./pages/ToolboxPage').then(m => ({ default: m.ToolboxPage })))
const AboutPage = lazy(() => import('./pages/AboutPage').then(m => ({ default: m.AboutPage })))
const ComicInfoDrawer = lazy(() => import('./components/ComicInfoDrawer').then(m => ({ default: m.ComicInfoDrawer })))
const ComicReaderModal = lazy(() => import('./components/ComicReaderModal').then(m => ({ default: m.ComicReaderModal })))
const UpdateDialog = lazy(() => import('./components/UpdateDialog').then(m => ({ default: m.UpdateDialog })))

/** 页面切换时的骨架屏 fallback。 */
function PageSkeleton() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="flex flex-col items-center gap-4">
        <div className="w-8 h-8 border-2 border-[var(--text-tertiary)] border-t-[var(--accent)] rounded-full animate-spin" />
        <div className="w-32 h-3 bg-[var(--bg-tertiary)] rounded animate-pulse" />
      </div>
    </div>
  )
}

function App() {
  const { sfwToastDismissed, dismissSfwToast } = useSettingsStore()
  const { setConfig } = useConfig()
  useTheme()
  const { setSfwMode, configLoaded } = useInitConfig()
  const setFatalError = useFatalErrorStore((s) => s.setError)
  // 启动进度：done=false 时覆盖渲染 <StartupScreen>，done=true 时淡出显示真实内容。
  // index.html 骨架屏 → React <StartupScreen>（视觉一致）→ 真实内容，三态无缝衔接。
  const startupProgress = useStartupProgress()

  // 首屏就绪信号：配置加载完成（首个 IPC getConfig 成功）= 真实内容可安全渲染。
  // 触发 markStartupReady 让 StartupScreen 淡出。Python 进度最高 95%，最后的
  // 95→100 由这个信号补上（设计文档"首屏就绪 95-100% 由渲染进程触发"的实现）。
  useEffect(() => {
    if (configLoaded) markStartupReady()
  }, [configLoaded])

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
        return <Suspense fallback={<PageSkeleton />}><DownloadPage /></Suspense>
      case 'favourites':
        return <Suspense fallback={<PageSkeleton />}><FavouritesPage onNavigateToSettings={() => { handlePageChange('settings'); setScrollTarget('login') }} /></Suspense>
      case 'history':
        return <Suspense fallback={<PageSkeleton />}><HistoryPage /></Suspense>
      case 'settings':
        return <Suspense fallback={<PageSkeleton />}><SettingsPage scrollTarget={scrollTarget} onScrollDone={() => setScrollTarget(null)} /></Suspense>
      case 'toolbox':
        return <Suspense fallback={<PageSkeleton />}><ToolboxPage /></Suspense>
      case 'about':
        return <Suspense fallback={<PageSkeleton />}><AboutPage /></Suspense>
      default:
        return <div className="text-[var(--text-primary)]">Unknown page</div>
    }
  }

  return (
    <div className="flex h-screen bg-[var(--bg-secondary)]">
      {/* 启动进度界面：done=false 时覆盖真实内容，done=true 时淡出。
          fixed inset-0 z-50 确保覆盖整个窗口，与真实内容切换通过 framer-motion 淡入淡出过渡。 */}
      <AnimatePresence>
        {!startupProgress.done && (
          <StartupScreen key="startup" {...startupProgress} />
        )}
      </AnimatePresence>
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
      <Suspense fallback={null}><ComicInfoDrawer /></Suspense>
      <Suspense fallback={null}><ComicReaderModal
        comic={readerComic}
        open={!!readerComic}
        onClose={closeReader}
      /></Suspense>
      {updateInfo && (
        <Suspense fallback={null}><UpdateDialog
          info={updateInfo}
          onClose={() => setUpdateInfo(null)}
        /></Suspense>
      )}
    </div>
  )
}

export default App
