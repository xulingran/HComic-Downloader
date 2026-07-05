import { useState, useEffect, useRef, useCallback } from 'react'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useToastStore } from '../stores/useToastStore'
import { useConfig, useProxyStatus, useAvailableFonts, useJmDomains } from '../hooks/useIpc'
import { useOptimisticConfig } from '../hooks/useOptimisticConfig'
import { useAuthState } from '../hooks/useAuthState'
import { COMIC_SOURCES, SOURCE_LABELS, SOURCES_WITH_FAVOURITES, type ConfigKey, type ConfigValueMap, type FontInfo, type ProxyStatus } from '@shared/types'
import { AppearanceSettings } from '../components/settings/AppearanceSettings'
import { DownloadSettings } from '../components/settings/DownloadSettings'
import { AuthSettings } from '../components/settings/AuthSettings'
import { ProxySettings } from '../components/settings/ProxySettings'
import { NotificationSettings } from '../components/settings/NotificationSettings'
import { CacheSettings } from '../components/settings/CacheSettings'
import { MigrationDialog } from '../components/settings/MigrationDialog'
import { Modal } from '../components/common/Modal'
import { copyDiagnosticsWithConfirm } from '../utils/diagnostics'
import { useMigration } from '../hooks/useMigration'

type OutputFormat = 'folder' | 'zip' | 'cbz'
type NotifyWhenForeground = 'inactive' | 'always'

interface ConfigState {
  downloadDir: string
  concurrentDownloads: number
  timeout: number
  retryTimes: number
  cbzFilenameTemplate: string
  batchDownloadDelay: number
  autoRetryMaxAttempts: number
  notifyOnComplete: boolean
  notifyWhenForeground: NotifyWhenForeground
  checkUpdateOnStart: boolean
  defaultSource: string
  defaultFavouriteSource: string
  previewCacheSizeLimitMB: number
  jmDomain: string
  moeimgUsername: string
  moeimgPassword: string
  bikaUsername?: string
  bikaPassword?: string
  hcomicUsername?: string
  hcomicPassword?: string
  nhUsername?: string
  nhPassword?: string
  previewPreloadForward: number
  previewPreloadBackward: number
  previewPreloadConcurrency: number
  previewPreloadAdaptive: boolean
}

interface SettingsPageProps {
  scrollTarget?: string | null
  onScrollDone?: () => void
}

export function SettingsPage({ scrollTarget, onScrollDone }: SettingsPageProps) {
  const { themeMode, cardStyle, sfwMode, defaultFavouriteSource, setThemeMode, setCardStyle, setSfwMode, setDefaultFavouriteSource } = useSettingsStore()
  const loginSectionRef = useRef<HTMLDivElement>(null!)
  const { getConfig, setConfig, openDownloadDir, selectDirectory } = useConfig()
  const hcomicAuth = useAuthState('hcomic')
  const jmAuth = useAuthState('jm')
  const moeimgAuth = useAuthState('moeimg')
  const bikaAuth = useAuthState('bika')
  const copymangaAuth = useAuthState('copymanga')
  const nhAuth = useAuthState('nh')
  const { getProxyStatus } = useProxyStatus()
  const { getAvailableFonts } = useAvailableFonts()
  const { getJmDomains } = useJmDomains()
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('folder')
  const [config, setConfigState] = useState<ConfigState>({
    downloadDir: '',
    concurrentDownloads: 4,
    timeout: 30,
    retryTimes: 3,
    cbzFilenameTemplate: '{author}-{title}.cbz',
    batchDownloadDelay: 1,
    autoRetryMaxAttempts: 2,
    notifyOnComplete: true,
    notifyWhenForeground: 'inactive',
    checkUpdateOnStart: true,
    defaultSource: 'hcomic',
    defaultFavouriteSource: '',
    previewCacheSizeLimitMB: 500,
    jmDomain: '',
    moeimgUsername: '',
    moeimgPassword: '',
    bikaUsername: '',
    bikaPassword: '',
    hcomicUsername: '',
    hcomicPassword: '',
    nhUsername: '',
    nhPassword: '',
    previewPreloadForward: 8,
    previewPreloadBackward: 2,
    previewPreloadConcurrency: 3,
    previewPreloadAdaptive: false,
  })
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [availableFonts, setAvailableFonts] = useState<FontInfo[]>([])
  const [jmDomains, setJmDomains] = useState<string[]>([])
  const [fontName, setFontName] = useState('')
  const [fontSize, setFontSize] = useState(14)
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus | null>(null)
  const [proxyLoading, setProxyLoading] = useState(false)
  const { createHandler } = useOptimisticConfig(setConfig, setSaveError, setIsSaving)
  const [isMigrationOpen, setIsMigrationOpen] = useState(false)
  const migrationHook = useMigration()
  // 下载目录变更触发的迁移确认：plan 后等待用户确认，确认后执行迁移
  const [pendingDirMigration, setPendingDirMigration] = useState<{
    migrationId: string
    totalItems: number
    newDir: string
  } | null>(null)
  const [jmDomainInput, setJmDomainInput] = useState('')
  const [jmDomainMode, setJmDomainMode] = useState<'auto' | 'custom'>('auto')

  const SECTIONS = [
    { id: 'appearance', label: '外观设置', icon: '🎨' },
    { id: 'download',   label: '下载设置', icon: '📥' },
    { id: 'source',     label: '来源',     icon: '🌐' },
    { id: 'auth',       label: '认证设置', icon: '🔑' },
    { id: 'proxy',      label: '代理设置', icon: '🔌' },
    { id: 'notification', label: '通知设置', icon: '🔔' },
    { id: 'cache',        label: '缓存管理', icon: '💾' },
    { id: 'diagnostics',  label: '诊断信息', icon: '🩺' },
  ] as const

  const [activeSection, setActiveSection] = useState<string | null>(null)

  const loadProxyStatus = useCallback(async () => {
    setProxyLoading(true)
    try {
      const result = await getProxyStatus()
      setProxyStatus(result)
    } catch {
      setProxyStatus(null)
    } finally {
      setProxyLoading(false)
    }
  }, [getProxyStatus])

  const loadConfig = async () => {
    try {
      const result = await getConfig()
      if (result.config) {
        setConfigState({
          downloadDir: result.config.downloadDir ?? '',
          concurrentDownloads: result.config.concurrentDownloads ?? 4,
          timeout: result.config.timeout ?? 30,
          retryTimes: result.config.retryTimes ?? 3,
          cbzFilenameTemplate: result.config.cbzFilenameTemplate ?? '{author}-{title}.cbz',
          batchDownloadDelay: result.config.batchDownloadDelay ?? 1,
          autoRetryMaxAttempts: result.config.autoRetryMaxAttempts ?? 2,
          notifyOnComplete: result.config.notifyOnComplete !== false,
          notifyWhenForeground: result.config.notifyWhenForeground ?? 'inactive',
          checkUpdateOnStart: result.config.checkUpdateOnStart !== false,
          defaultSource: result.config.defaultSource ?? 'hcomic',
          defaultFavouriteSource: result.config.defaultFavouriteSource ?? '',
          previewCacheSizeLimitMB: result.config.previewCacheSizeLimitMB ?? 500,
          jmDomain: result.config.jmDomain ?? '',
          moeimgUsername: result.config.moeimgUsername ?? '',
          moeimgPassword: result.config.moeimgPassword ?? '',
          bikaUsername: result.config.bikaUsername ?? '',
          bikaPassword: result.config.bikaPassword ?? '',
          hcomicUsername: result.config.hcomicUsername ?? '',
          hcomicPassword: result.config.hcomicPassword ?? '',
          nhUsername: result.config.nhUsername ?? '',
          nhPassword: result.config.nhPassword ?? '',
          previewPreloadForward: result.config.previewPreloadForward ?? 8,
          previewPreloadBackward: result.config.previewPreloadBackward ?? 2,
          previewPreloadConcurrency: result.config.previewPreloadConcurrency ?? 3,
          previewPreloadAdaptive: result.config.previewPreloadAdaptive ?? false,
        })
        setJmDomainInput(result.config.jmDomain ?? '')
        setJmDomainMode(result.config.jmDomain ? 'custom' : 'auto')
        if (result.config.outputFormat) {
          setOutputFormat(result.config.outputFormat as OutputFormat)
        }
        if (result.config.themeMode === 'light' || result.config.themeMode === 'dark' || result.config.themeMode === 'auto') {
          setThemeMode(result.config.themeMode)
        }
        if (result.config.hasAuth) {
          hcomicAuth.verifyFromConfig(true)
        }
        if (result.config.hasJmAuth) {
          jmAuth.verifyFromConfig(true)
        }
        if (result.config.hasMoeimgAuth) {
          moeimgAuth.verifyFromConfig(true)
        }
        if (result.config.hasBikaAuth) {
          bikaAuth.verifyFromConfig(true)
        }
        if (result.config.hasCopymangaAuth) {
          copymangaAuth.verifyFromConfig(true)
        }
        if (result.config.hasNhAuth) {
          nhAuth.verifyFromConfig(true)
        }
        if (result.config.fontName) setFontName(result.config.fontName)
        if (result.config.fontSize) setFontSize(result.config.fontSize)
        if (typeof result.config.previewCacheSizeLimitMB === 'number') {
          setConfigState(prev => ({ ...prev, previewCacheSizeLimitMB: result.config.previewCacheSizeLimitMB }))
        }
      }
    } catch (err) {
      console.error('Failed to load config:', err)
      useToastStore.getState().error('加载配置失败')
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadConfig()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (scrollTarget === 'login' && loginSectionRef.current) {
      loginSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
      onScrollDone?.()
    }
  }, [scrollTarget, onScrollDone])

  useEffect(() => {
    getAvailableFonts().then((result) => setAvailableFonts(result.fonts)).catch(() => {})
    getJmDomains().then((result) => setJmDomains(result.domains)).catch(() => {})
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProxyStatus()
  }, [getAvailableFonts, getJmDomains, loadProxyStatus])

  const handleThemeChange = createHandler('themeMode', () => themeMode, setThemeMode, (prev) => setThemeMode(prev))

  const handleCardStyleChange = createHandler('cardStyle', () => cardStyle, setCardStyle, (prev) => setCardStyle(prev))

  const handleDefaultFavouriteSourceChange = createHandler('defaultFavouriteSource', () => defaultFavouriteSource, setDefaultFavouriteSource, (prev) => setDefaultFavouriteSource(prev))

  const handleSfwModeChange = createHandler('sfwMode', () => sfwMode, setSfwMode, (prev) => setSfwMode(prev))

  const handleOutputFormatChange = createHandler('outputFormat', () => outputFormat, setOutputFormat, (prev) => setOutputFormat(prev))

  const handleConfigChange = async (key: ConfigKey, value: unknown) => {
    setSaveError(null)
    const prevValue = (config as unknown as Record<string, unknown>)[key]
    setConfigState(prev => ({ ...prev, [key]: value }))
    setIsSaving(true)
    try {
      await setConfig(key, value as ConfigValueMap[ConfigKey])
    } catch (err: unknown) {
      setConfigState(prev => ({ ...prev, [key]: prevValue }))
      setSaveError((err instanceof Error ? err.message : String(err)) || '保存失败')
      setTimeout(() => setSaveError(null), 5000)
    } finally {
      setIsSaving(false)
    }
  }

  const handleTextConfigChange = (key: ConfigKey, value: string) => {
    setSaveError(null)
    setConfigState(prev => ({ ...prev, [key]: value }))
  }

  const handleTextConfigBlur = async (key: ConfigKey) => {
    const value = (config as unknown as Record<string, unknown>)[key]
    setIsSaving(true)
    try {
      const result = await setConfig(key, value as ConfigValueMap[ConfigKey]) as
        { success: boolean; migrationTriggered?: boolean; migrationId?: string; migrationTotalItems?: number } | null
      // 下载目录变更可能触发文件迁移：后端 plan 完毕，等待前端确认后才执行
      if (
        key === 'downloadDir' &&
        result?.migrationTriggered &&
        result.migrationId &&
        typeof result.migrationTotalItems === 'number'
      ) {
        setPendingDirMigration({
          migrationId: result.migrationId,
          totalItems: result.migrationTotalItems,
          newDir: value as string,
        })
      }
    } catch (err: unknown) {
      try {
        const result = await getConfig()
        if (result.config) {
          const restored = (result.config as unknown as Record<string, unknown>)[key]
          if (restored !== undefined) {
            setConfigState(prev => ({ ...prev, [key]: restored }))
          }
        }
      } catch { /* reload 也失败则只显示错误 */ }
      setSaveError((err instanceof Error ? err.message : String(err)) || '保存失败')
      setTimeout(() => setSaveError(null), 5000)
    } finally {
      setIsSaving(false)
    }
  }

  const authMap = {
    hcomic: hcomicAuth,
    jm: jmAuth,
    moeimg: moeimgAuth,
    bika: bikaAuth,
    copymanga: copymangaAuth,
    nh: nhAuth,
  } as const

  const handleApplyAuth = async (curlText: string, source: string = 'hcomic') => {
    const auth = authMap[source as keyof typeof authMap] ?? hcomicAuth
    await auth.apply(curlText)
  }

  // 下载目录迁移确认：用户确认后执行迁移（文件移动 + DB 更新 + 落库）
  const handleConfirmDirMigration = async () => {
    if (!pendingDirMigration) return
    try {
      await migrationHook.confirmMigration(pendingDirMigration.migrationId)
      useToastStore.getState().success(`正在迁移 ${pendingDirMigration.totalItems} 个文件…`)
    } catch (err: unknown) {
      setSaveError((err instanceof Error ? err.message : String(err)) || '启动迁移失败')
      setTimeout(() => setSaveError(null), 5000)
    }
    setPendingDirMigration(null)
  }

  // 下载目录迁移取消：回滚 configState 到后端真实值（旧 download_dir，未落库）
  const handleCancelDirMigration = async () => {
    if (!pendingDirMigration) return
    try {
      await migrationHook.cancelMigration()
    } catch {
      /* cancel 失败不阻断 */
    }
    // 后端 download_dir 未落库仍是旧值，重新拉取回填本地 state
    try {
      const result = await getConfig()
      if (result.config) {
        setConfigState(prev => ({ ...prev, downloadDir: result.config.downloadDir ?? prev.downloadDir }))
      }
    } catch { /* reload 失败则保留当前显示，下次加载会修正 */ }
    setPendingDirMigration(null)
  }

  // 迁移完成时刷新本地 configState（迁移成功后后端已落库新 download_dir）
  useEffect(() => {
    if (migrationHook.complete) {
      const c = migrationHook.complete
      if (c.failed > 0) {
        useToastStore.getState().error(`迁移完成：成功 ${c.succeeded}，失败 ${c.failed}（请查看迁移日志）`)
      } else {
        useToastStore.getState().success(`迁移完成：${c.succeeded} 个文件已更新`)
      }
      // 刷新本地 configState 以反映后端已落库的新 download_dir
      getConfig().then(result => {
        if (result.config) {
          setConfigState(prev => ({ ...prev, downloadDir: result.config.downloadDir ?? prev.downloadDir }))
        }
      }).catch(() => { /* 刷新失败不阻断 */ })
    }
  }, [migrationHook.complete, getConfig])

  const handleTestAuth = async (source: string = 'hcomic') => {
    const auth = authMap[source as keyof typeof authMap] ?? hcomicAuth
    await auth.test()
  }

  const handleOpenLoginWindow = async (source: string = 'hcomic') => {
    const auth = authMap[source as keyof typeof authMap] ?? hcomicAuth
    await auth.openWindow(auth.status)
  }

  const handleHcomicLogin = async (username: string, password: string) => {
    hcomicAuth.setStatus('verifying')
    hcomicAuth.setMessage('')
    try {
      const result = await window.hcomic?.hcomicLogin(username, password)
      if (result?.success) {
        await hcomicAuth.test()
      } else {
        hcomicAuth.setStatus('error')
        hcomicAuth.setMessage(result?.message || '登录失败')
      }
    } catch (err) {
      hcomicAuth.setStatus('error')
      hcomicAuth.setMessage(
        (err instanceof Error ? err.message : String(err)) || '登录失败',
      )
    }
  }

  const handleMoeimgLogin = async (username: string, password: string) => {
    moeimgAuth.setStatus('verifying')
    moeimgAuth.setMessage('')
    try {
      const result = await window.hcomic?.moeimgLogin(username, password)
      if (result?.success) {
        await moeimgAuth.test()
      }
    } catch (err) {
      moeimgAuth.setStatus('error')
      moeimgAuth.setMessage(
        (err instanceof Error ? err.message : String(err)) || '登录失败',
      )
    }
  }

  const handleBikaLogin = async (username: string, password: string) => {
    bikaAuth.setStatus('verifying')
    bikaAuth.setMessage('')
    try {
      const result = await window.hcomic?.bikaLogin(username, password)
      if (result?.success) {
        await bikaAuth.test()
      }
    } catch (err) {
      bikaAuth.setStatus('error')
      bikaAuth.setMessage(
        (err instanceof Error ? err.message : String(err)) || '登录失败',
      )
    }
  }

  const handleNhLogin = async (username: string, password: string) => {
    nhAuth.setStatus('verifying')
    nhAuth.setMessage('')
    try {
      const result = await window.hcomic?.nhLogin(username, password)
      if (result?.success) {
        await nhAuth.test()
      } else {
        nhAuth.setStatus('error')
        nhAuth.setMessage(result?.message || '登录失败')
      }
    } catch (err) {
      nhAuth.setStatus('error')
      nhAuth.setMessage(
        (err instanceof Error ? err.message : String(err)) || '登录失败',
      )
    }
  }

  const handleSectionClick = (sectionId: string) => {
    setActiveSection(sectionId)
    document.getElementById(`section-${sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setTimeout(() => setActiveSection(null), 1500)
  }

  return (
    <div className="flex gap-0 max-w-5xl">
      {/* Sidebar */}
      <div className="w-[150px] shrink-0">
        <nav className="sticky top-6 space-y-0.5 pr-3">
          <div className="px-3 py-2 text-xs font-semibold text-[var(--text-secondary)] tracking-wide">
            设置区域
          </div>
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              onClick={() => handleSectionClick(section.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors
                ${activeSection === section.id
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
                }`}
            >
              <span className="mr-2">{section.icon}</span>
              {section.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">设置</h2>
        <div className="flex items-center gap-2">
          {saveError && (
            <span className="text-sm text-red-500">{saveError}</span>
          )}
          {isSaving && (
            <span className="text-sm text-[var(--text-secondary)]">保存中...</span>
          )}
        </div>
      </div>

      {migrationHook.isActive && (
        <div className="bg-[var(--accent)]/10 border border-[var(--accent)] rounded-xl px-6 py-4 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              正在后台迁移漫画库 ({migrationHook.progress?.completed ?? 0}/{migrationHook.progress?.total ?? 0})
            </p>
            <div className="w-full h-1.5 bg-[var(--bg-secondary)] rounded-full mt-2 overflow-hidden">
              <div
                className="h-full bg-[var(--accent)] rounded-full transition-[width] duration-slow"
                style={{
                  width: `${migrationHook.progress && migrationHook.progress.total > 0
                    ? Math.round((migrationHook.progress.completed / migrationHook.progress.total) * 100) : 0}%`
                }}
              />
            </div>
          </div>
          <button
            onClick={() => setIsMigrationOpen(true)}
            className="px-3 py-1.5 text-sm rounded-lg bg-[var(--accent)] text-white whitespace-nowrap"
          >
            查看详情
          </button>
        </div>
      )}

      <div id="section-appearance">
        <AppearanceSettings
          themeMode={themeMode}
          cardStyle={cardStyle}
          sfwMode={sfwMode}
          availableFonts={availableFonts}
          fontName={fontName}
          fontSize={fontSize}
          onThemeChange={handleThemeChange}
          onCardStyleChange={handleCardStyleChange}
          onSfwModeChange={handleSfwModeChange}
          onFontNameChange={setFontName}
          onFontSizeChange={setFontSize}
          setConfig={setConfig}
          setSaveError={setSaveError}
          setIsSaving={setIsSaving}
        />
      </div>

      <div id="section-download">
        <DownloadSettings
          outputFormat={outputFormat}
          config={{
            downloadDir: config.downloadDir,
            concurrentDownloads: config.concurrentDownloads,
            timeout: config.timeout,
            retryTimes: config.retryTimes,
            cbzFilenameTemplate: config.cbzFilenameTemplate,
            batchDownloadDelay: config.batchDownloadDelay,
          }}
          onOutputFormatChange={handleOutputFormatChange}
          onConfigChange={handleConfigChange}
          onTextConfigChange={handleTextConfigChange}
          onTextConfigBlur={handleTextConfigBlur}
          openDownloadDir={openDownloadDir}
          onSelectDirectory={async () => {
            const result = await selectDirectory('选择下载目录', config.downloadDir || undefined)
            if (!result.canceled && result.filePaths.length > 0) {
              handleConfigChange('downloadDir', result.filePaths[0])
            }
          }}
          setSaveError={setSaveError}
          onOpenMigration={() => setIsMigrationOpen(true)}
        />
      </div>

      <div id="section-source">
        <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm space-y-6">
          <h3 className="text-base font-medium text-[var(--text-primary)] border-b border-[var(--border)] pb-3">
            来源
          </h3>

          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">默认来源</label>
            <div className="flex gap-3">
              {COMIC_SOURCES.map((source) => (
                <button
                  key={source}
                  onClick={() => handleConfigChange('defaultSource', source)}
                  className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                    config.defaultSource === source
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]'
                  }`}
                >
                  {SOURCE_LABELS[source]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
              默认收藏夹来源
            </label>
            <p className="text-xs text-[var(--text-secondary)] mb-3">
              设置后进入收藏夹将直接加载该来源；选择「未设置」则每次启动首次进入时询问
            </p>
            <div className="flex flex-wrap gap-3" data-testid="default-favourite-source-group">
              <button
                onClick={() => handleDefaultFavouriteSourceChange('')}
                className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                  defaultFavouriteSource === ''
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]'
                }`}
              >
                未设置（每次询问）
              </button>
              {SOURCES_WITH_FAVOURITES.map((source) => (
                <button
                  key={source}
                  onClick={() => handleDefaultFavouriteSourceChange(source)}
                  className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                    defaultFavouriteSource === source
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]'
                  }`}
                >
                  {SOURCE_LABELS[source]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">JM 域名</label>
            <p className="text-xs text-[var(--text-secondary)] mb-3">
              默认使用 18comic.vip，以下列表来自发布页，可手动切换
            </p>
            <div className="flex gap-2 items-start">
              <div className="flex-1">
                <select
                  value={jmDomainInput || '18comic.vip'}
                  onChange={async (e) => {
                    const domain = e.target.value
                    setJmDomainInput(domain === '18comic.vip' ? '' : domain)
                    setJmDomainMode(domain === '18comic.vip' ? 'auto' : 'custom')
                    handleConfigChange('jmDomain', domain === '18comic.vip' ? '' : domain)
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value="18comic.vip">18comic.vip (默认)</option>
                  {jmDomains.filter(d => d !== '18comic.vip').map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                  <option value="__custom__">自定义域名…</option>
                </select>
              </div>
            </div>
            {jmDomainInput === '__custom__' || (jmDomainMode === 'custom' && !jmDomains.includes(jmDomainInput) && jmDomainInput !== '18comic.vip') ? (
              <div className="flex gap-2 items-start mt-2">
                <div className="flex-1">
                  <input
                    type="text"
                    value={jmDomainInput === '__custom__' ? '' : jmDomainInput}
                    onChange={(e) => setJmDomainInput(e.target.value)}
                    onBlur={async () => {
                      const domain = jmDomainInput.trim()
                      if (!domain || domain === '__custom__') return
                      if (domain === config.jmDomain) return
                      handleConfigChange('jmDomain', domain)
                    }}
                    onKeyDown={async (e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                    }}
                    placeholder="例如 18comic.vip"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div id="section-auth">
        <AuthSettings
          loginSectionRef={loginSectionRef}
          loginStatus={hcomicAuth.status}
          loginMessage={hcomicAuth.message}
          hcomicSavedUsername={config.hcomicUsername || ''}
          hcomicSavedPassword={config.hcomicPassword || ''}
          jmLoginStatus={jmAuth.status}
          jmLoginMessage={jmAuth.message}
          moeimgLoginStatus={moeimgAuth.status}
          moeimgLoginMessage={moeimgAuth.message}
          moeimgSavedUsername={config.moeimgUsername}
          moeimgSavedPassword={config.moeimgPassword || ''}
          bikaLoginStatus={bikaAuth.status}
          bikaLoginMessage={bikaAuth.message}
          bikaSavedUsername={config.bikaUsername || ''}
          bikaSavedPassword={config.bikaPassword || ''}
          copymangaLoginStatus={copymangaAuth.status}
          copymangaLoginMessage={copymangaAuth.message}
          nhLoginStatus={nhAuth.status}
          nhLoginMessage={nhAuth.message}
          nhSavedUsername={config.nhUsername || ''}
          nhSavedPassword={config.nhPassword || ''}
          onApplyAuth={handleApplyAuth}
          onTestAuth={handleTestAuth}
          onOpenLoginWindow={handleOpenLoginWindow}
          onHcomicLogin={handleHcomicLogin}
          onMoeimgLogin={handleMoeimgLogin}
          onBikaLogin={handleBikaLogin}
          onNhLogin={handleNhLogin}
        />
      </div>

      <div id="section-proxy">
        <ProxySettings
          proxyStatus={proxyStatus}
          proxyLoading={proxyLoading}
          onRefresh={loadProxyStatus}
        />
      </div>

      <div id="section-notification">
        <NotificationSettings
          notifyOnComplete={config.notifyOnComplete}
          notifyWhenForeground={config.notifyWhenForeground}
          checkUpdateOnStart={config.checkUpdateOnStart}
          onConfigChange={handleConfigChange}
        />
      </div>

      <div id="section-cache">
        <CacheSettings
          sizeLimitMB={config.previewCacheSizeLimitMB}
          onSizeLimitChange={(mb) => handleConfigChange('previewCacheSizeLimitMB', mb)}
          previewPreloadForward={config.previewPreloadForward}
          previewPreloadBackward={config.previewPreloadBackward}
          previewPreloadConcurrency={config.previewPreloadConcurrency}
          previewPreloadAdaptive={config.previewPreloadAdaptive}
          onConfigChange={handleConfigChange}
        />
      </div>

      <div id="section-diagnostics">
        <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm space-y-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">诊断信息</h3>
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
            遇到问题时，可复制诊断日志提供给开发者以便排查。日志可能包含 cookie、搜索词等敏感信息，复制前会有确认提示。
          </p>
          <button
            onClick={copyDiagnosticsWithConfirm}
            className="px-4 py-2 rounded-lg text-sm font-medium
                       bg-[var(--accent)] text-white hover:opacity-90
                       transition-opacity"
          >
            复制诊断日志
          </button>
        </div>
      </div>

        <MigrationDialog
          isOpen={isMigrationOpen}
          onClose={() => setIsMigrationOpen(false)}
          currentDownloadDir={config.downloadDir}
          onSelectDirectory={selectDirectory}
        />

        {/* 下载目录变更触发的迁移确认弹窗 */}
        <Modal
          isOpen={pendingDirMigration !== null}
          onClose={handleCancelDirMigration}
          closeOnOverlayClick={false}
          ariaLabel="下载目录迁移确认"
          contentClassName="w-[420px] rounded-xl bg-[var(--bg-primary)] p-6 space-y-4"
        >
          {pendingDirMigration && (
            <>
              <h3 className="text-base font-semibold text-[var(--text-primary)]">迁移下载文件</h3>
              <p className="text-sm text-[var(--text-secondary)]">
                检测到 <span className="font-semibold text-[var(--text-primary)]">{pendingDirMigration.totalItems}</span> 个已下载文件在旧目录，
                将自动迁移到新目录并更新历史记录。
              </p>
              <p className="text-xs text-[var(--text-secondary)] break-all">
                新目录：{pendingDirMigration.newDir}
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={handleCancelDirMigration}
                  className="px-4 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                >
                  取消
                </button>
                <button
                  onClick={handleConfirmDirMigration}
                  className="px-4 py-2 text-sm rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
                >
                  确认迁移
                </button>
              </div>
            </>
          )}
        </Modal>
      </div>
    </div>
  )
}
