import { useState, useEffect, useCallback } from 'react'
import { useTheme } from './hooks/useTheme'
import { useSettingsStore } from './stores/useSettingsStore'
import { useConfig } from './hooks/useIpc'
import { Sidebar } from './components/Sidebar'
import { SearchPage } from './pages/SearchPage'
import { DownloadPage } from './pages/DownloadPage'
import { FavouritesPage } from './pages/FavouritesPage'
import { SettingsPage } from './pages/SettingsPage'
import { Toast } from './components/common/Toast'
import { ComicInfoDrawer } from './components/ComicInfoDrawer'
import { useDrawerStore } from './stores/useDrawerStore'

function App() {
  const {
    sfwToastDismissed,
    setThemeMode, setSfwMode, dismissSfwToast
  } = useSettingsStore()
  const { getConfig, setConfig } = useConfig()
  useTheme()

  const [showSfwToast, setShowSfwToast] = useState(false)

  useEffect(() => {
    getConfig().then((result) => {
      // 应用主题配置
      const mode = result?.config?.themeMode
      if (mode === 'light' || mode === 'dark' || mode === 'auto') {
        setThemeMode(mode)
      }
      // 特意设计：每次启动都强制开启 SFW 模式，不从持久化配置恢复
      // 原因：SFW 是安全默认值，即使上次会话关闭了 SFW，本次启动也必须以安全状态开始
      //       避免封面图在启动时被意外加载（尤其适用于公共 / 截屏场景）
      //       用户可在会话中通过设置页面或 Toast 按钮主动关闭 SFW
      setSfwMode(true)
      setConfig('sfwMode', true).catch(() => {})
      setShowSfwToast(true)
    }).catch(() => {
      // 配置加载失败时使用默认值
      setSfwMode(true)
      setShowSfwToast(true)
    })
  }, [setThemeMode, setSfwMode, setConfig, getConfig])

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

  const [activePage, setActivePage] = useState('search')
  const [scrollTarget, setScrollTarget] = useState<string | null>(null)
  const { pendingSearch } = useDrawerStore()

  useEffect(() => {
    if (pendingSearch && activePage !== 'search') {
      setActivePage('search')
    }
  }, [pendingSearch, activePage])

  const renderPage = () => {
    switch (activePage) {
      case 'search':
        return <SearchPage />
      case 'downloads':
        return <DownloadPage />
      case 'favourites':
        return <FavouritesPage onNavigateToSettings={() => { setActivePage('settings'); setScrollTarget('login') }} />
      case 'settings':
        return <SettingsPage scrollTarget={scrollTarget} onScrollDone={() => setScrollTarget(null)} />
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
        <main className="flex-1 overflow-auto p-6">
          {renderPage()}
        </main>
      </div>
      <ComicInfoDrawer />
    </div>
  )
}

export default App
