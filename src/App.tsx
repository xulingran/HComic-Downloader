import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { TAB_ORDER, useTabPageVariants } from './lib/anim'
import { prefetchHighFrequencyChunks } from './lib/prefetch'
import { useTheme } from './hooks/useTheme'
import { useSettingsStore } from './stores/useSettingsStore'
import { useConfig } from './hooks/useIpc'
import { useInitConfig } from './hooks/useInitConfig'
import { useStartupProgress, markStartupReady } from './hooks/useStartupProgress'
import { Sidebar } from './components/Sidebar'
import { PageSkeleton } from './components/common/PageSkeleton'
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
const MaintenancePage = lazy(() => import('./pages/MaintenancePage').then(m => ({ default: m.MaintenancePage })))
const AboutPage = lazy(() => import('./pages/AboutPage').then(m => ({ default: m.AboutPage })))
const ComicInfoDrawer = lazy(() => import('./components/ComicInfoDrawer').then(m => ({ default: m.ComicInfoDrawer })))
const ComicReaderModal = lazy(() => import('./components/ComicReaderModal').then(m => ({ default: m.ComicReaderModal })))
const UpdateDialog = lazy(() => import('./components/UpdateDialog').then(m => ({ default: m.UpdateDialog })))

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

  // 懒加载预热：应用就绪后（StartupScreen 淡出、主内容开始渲染）在空闲窗口静默拉取高频
  // lazy chunk，把首次切换的下载/编译成本前移到用户无感知时段。仅加载不渲染。
  // 用 ref 守卫确保只触发一次（done 可能在 Python 100% 与 configLoaded 间抖动）。
  const prefetchStartedRef = useRef(false)
  useEffect(() => {
    if (!startupProgress.done || prefetchStartedRef.current) return
    prefetchStartedRef.current = true
    prefetchHighFrequencyChunks()
  }, [startupProgress.done])

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
  // keep-alive：已访问页面集合，懒创建——首屏只含 search，用户访问新 tab 时才加入。
  // 切走不卸载、切回复用实例，消除重复 mount 与 stagger 重播。
  const [visitedPages, setVisitedPages] = useState<string[]>(['search'])
  const { pendingSearch } = useDrawerStore()
  const { readerComic, closeReader } = useReaderStore()
  const tabVariants = useTabPageVariants()

  const handlePageChange = useCallback((page: string) => {
    const oldIndex = TAB_ORDER.indexOf(activePage as typeof TAB_ORDER[number])
    const newIndex = TAB_ORDER.indexOf(page as typeof TAB_ORDER[number])
    setDirection(oldIndex === -1 || page === activePage ? 0 : newIndex > oldIndex ? 1 : -1)
    setActivePage(page)
    // 懒创建：首次访问新页面时加入存活集合
    setVisitedPages((prev) => (prev.includes(page) ? prev : [...prev, page]))
  }, [activePage])

  useEffect(() => {
    if (pendingSearch && activePage !== 'search') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      handlePageChange('search')
    }
  }, [pendingSearch, activePage, handlePageChange])

  const renderPageContent = (page: string) => {
    switch (page) {
      case 'search':
        return <SearchPage onNavigateToSettings={() => { handlePageChange('settings'); setScrollTarget('login') }} />
      case 'downloads':
        return <Suspense fallback={<PageSkeleton />}><DownloadPage isActive={activePage === 'downloads'} /></Suspense>
      case 'favourites':
        return <Suspense fallback={<PageSkeleton />}><FavouritesPage onNavigateToSettings={() => { handlePageChange('settings'); setScrollTarget('login') }} /></Suspense>
      case 'history':
        return <Suspense fallback={<PageSkeleton />}><HistoryPage /></Suspense>
      case 'settings':
        return <Suspense fallback={<PageSkeleton />}><SettingsPage scrollTarget={scrollTarget} onScrollDone={() => setScrollTarget(null)} /></Suspense>
      case 'toolbox':
        return <Suspense fallback={<PageSkeleton />}><ToolboxPage /></Suspense>
      case 'maintenance':
        return <Suspense fallback={<PageSkeleton />}><MaintenancePage /></Suspense>
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
          {/* keep-alive 容器：遍历已访问页面，每个页面一个常驻 motion.div。
              激活页 display:block 并播放进入动画（slide 8% + fade，方向感知）；
              非激活页 display:none 不参与渲染（跳过 layout 与 paint）。
              切回已访问页面时实例复用，无 mount、无 stagger 重播。
              首次进入直接渲染真实内容——chunk 已由 idle prefetch 预热，
              数据走 store 缓存快路径，无需骨架兜底（避免骨架闪现）。 */}
          {visitedPages.map((page) => {
            const isActive = page === activePage
            return (
              <motion.div
                key={page}
                variants={tabVariants}
                custom={direction}
                initial="initial"
                animate="animate"
                aria-hidden={!isActive}
                className="absolute inset-0 overflow-auto"
                style={{ display: isActive ? 'block' : 'none' }}
              >
                {renderPageContent(page)}
              </motion.div>
            )
          })}
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
