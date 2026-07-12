import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { AnimatePresence } from 'framer-motion'
import { TAB_ORDER, useReducedMotionPreference } from './lib/anim'
import { prefetchHighFrequencyChunks } from './lib/prefetch'
import { useTheme } from './hooks/useTheme'
import { useSettingsStore } from './stores/useSettingsStore'
import { useConfig } from './hooks/useIpc'
import { useInitConfig } from './hooks/useInitConfig'
import { useStartupProgress, markStartupReady } from './hooks/useStartupProgress'
import { Sidebar } from './components/Sidebar'
import { KeepAlivePage, type TabPagePhase } from './components/KeepAlivePage'
import { PageSkeleton } from './components/common/PageSkeleton'
import { SearchPage } from './pages/SearchPage'
import { Toast } from './components/common/Toast'
import { Toaster } from './components/common/Toaster'
import { FatalBanner } from './components/FatalBanner'
import { StartupScreen } from './components/StartupScreen'
import { useDrawerStore } from './stores/useDrawerStore'
import { useReaderStore } from './stores/useReaderStore'
import { useLocalReaderStore } from './stores/useLocalReaderStore'
import { useFatalErrorStore } from './stores/useFatalErrorStore'
import { useSidebarStore } from './stores/useSidebarStore'
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
const LocalLibraryReaderModal = lazy(() => import('./components/library/LocalLibraryReaderModal').then(m => ({ default: m.LocalLibraryReaderModal })))
const UpdateDialog = lazy(() => import('./components/UpdateDialog').then(m => ({ default: m.UpdateDialog })))

type TabTransitionPhase = 'idle' | 'exiting' | 'entering'

interface TabTransitionState {
  /** 侧边栏和程序化导航表达的最新目标。 */
  targetPage: string
  /** 当前唯一允许显示真实内容的页面。 */
  visiblePage: string
  phase: TabTransitionPhase
  direction: number
  transitionId: number
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

  const reduceMotion = useReducedMotionPreference()
  const [tabTransition, setTabTransition] = useState<TabTransitionState>({
    targetPage: 'search',
    visiblePage: 'search',
    phase: 'idle',
    direction: 0,
    transitionId: 0,
  })
  const activePage = tabTransition.targetPage
  const [scrollTarget, setScrollTarget] = useState<string | null>(null)
  // keep-alive：已访问页面集合，懒创建——首屏只含 search，用户访问新 tab 时才加入。
  // 切走不卸载、切回复用实例，消除重复 mount 与 stagger 重播。
  const [visitedPages, setVisitedPages] = useState<string[]>(['search'])
  const { pendingSearch } = useDrawerStore()
  const {
    readerComic,
    open: readerOpen,
    closingSessionId: readerClosingSessionId,
    closeReader,
    finalizeClose: finalizeReaderClose,
  } = useReaderStore()
  const {
    readerAsset: localReaderAsset,
    launchMode: localReaderLaunchMode,
    open: localReaderOpen,
    closingSessionId: localReaderClosingSessionId,
    closeReader: closeLocalReader,
    finalizeClose: finalizeLocalReaderClose,
  } = useLocalReaderStore()

  const getPageDirection = useCallback((from: string, to: string) => {
    const oldIndex = TAB_ORDER.indexOf(from as typeof TAB_ORDER[number])
    const newIndex = TAB_ORDER.indexOf(to as typeof TAB_ORDER[number])
    return oldIndex === -1 || newIndex === -1 || from === to ? 0 : newIndex > oldIndex ? 1 : -1
  }, [])

  const handlePageChange = useCallback((page: string) => {
    setVisitedPages((prev) => (prev.includes(page) ? prev : [...prev, page]))
    setTabTransition((prev) => {
      if (page === prev.targetPage) return prev
      if (reduceMotion) {
        return {
          targetPage: page,
          visiblePage: page,
          phase: 'idle',
          direction: 0,
          transitionId: prev.transitionId + 1,
        }
      }
      if (prev.phase !== 'idle') {
        // 当前半阶段继续完成，只替换最新目标；完成回调会跳过过时的中间页面。
        return { ...prev, targetPage: page }
      }
      return {
        targetPage: page,
        visiblePage: prev.visiblePage,
        phase: 'exiting',
        direction: getPageDirection(prev.visiblePage, page),
        transitionId: prev.transitionId + 1,
      }
    })
  }, [getPageDirection, reduceMotion])

  const handleTabPhaseComplete = useCallback((
    page: string,
    completedPhase: 'exiting' | 'entering',
    transitionId: number,
  ) => {
    setTabTransition((prev) => {
      if (
        prev.transitionId !== transitionId
        || prev.phase !== completedPhase
        || prev.visiblePage !== page
      ) return prev

      if (completedPhase === 'exiting') {
        const targetPage = prev.targetPage
        return {
          ...prev,
          visiblePage: targetPage,
          phase: 'entering',
          direction: getPageDirection(page, targetPage),
        }
      }

      if (prev.targetPage !== page) {
        return {
          ...prev,
          phase: 'exiting',
          direction: getPageDirection(page, prev.targetPage),
          transitionId: prev.transitionId + 1,
        }
      }
      return { ...prev, phase: 'idle', direction: 0 }
    })
  }, [getPageDirection])

  // 用户在动画中途启用 reduced-motion 时，立即收敛到最新目标。
  useEffect(() => {
    if (!reduceMotion) return
    // preference 可能在过渡中由系统设置实时切换，需要把动画状态立即归一到最新目标。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTabTransition((prev) => prev.phase === 'idle' && prev.visiblePage === prev.targetPage
      ? prev
      : {
          ...prev,
          visiblePage: prev.targetPage,
          phase: 'idle',
          direction: 0,
          transitionId: prev.transitionId + 1,
        })
  }, [reduceMotion])

  useEffect(() => {
    if (pendingSearch && activePage !== 'search') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      handlePageChange('search')
    }
  }, [pendingSearch, activePage, handlePageChange])

  // Ctrl/Cmd+B：切换侧边栏收起/展开（VS Code 惯例）。
  // 守卫：忽略文本输入场景与 Shift/Alt 修饰，避免与编辑器/其它快捷键冲突。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isToggleShortcut = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'b' || e.key === 'B')
      if (!isToggleShortcut) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      e.preventDefault()
      useSidebarStore.getState().toggle()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const renderPageContent = (page: string) => {
    switch (page) {
      case 'search':
        return <SearchPage onNavigateToSettings={() => { handlePageChange('settings'); setScrollTarget('login') }} />
      case 'downloads':
        return <Suspense fallback={<PageSkeleton />}><DownloadPage isActive={tabTransition.visiblePage === 'downloads' && tabTransition.phase !== 'exiting'} /></Suspense>
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
          {/* keep-alive 页面永不卸载；集中状态机按退出→隐藏→进入顺序驱动，
              任意时刻只允许一个页面的真实内容可见。 */}
          {visitedPages.map((page) => {
            let phase: TabPagePhase = 'hidden'
            if (page === tabTransition.visiblePage) {
              phase = tabTransition.phase === 'idle' ? 'visible' : tabTransition.phase
            }
            return (
              <KeepAlivePage
                key={page}
                page={page}
                phase={phase}
                direction={tabTransition.direction}
                transitionId={tabTransition.transitionId}
                onPhaseComplete={handleTabPhaseComplete}
              >
                {renderPageContent(page)}
              </KeepAlivePage>
            )
          })}
        </main>
      </div>
      <Suspense fallback={null}><ComicInfoDrawer /></Suspense>
      <Suspense fallback={null}><ComicReaderModal
        comic={readerComic}
        open={readerOpen}
        onClose={closeReader}
        onExitComplete={() => finalizeReaderClose(readerClosingSessionId)}
      /></Suspense>
      <Suspense fallback={null}><LocalLibraryReaderModal
        asset={localReaderAsset}
        launchMode={localReaderLaunchMode}
        open={localReaderOpen}
        onClose={closeLocalReader}
        onExitComplete={() => finalizeLocalReaderClose(localReaderClosingSessionId)}
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
