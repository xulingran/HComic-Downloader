import { useState, useEffect, useRef, useCallback } from 'react'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useConfig, useProxyStatus, useAvailableFonts } from '../hooks/useIpc'
import { useOptimisticConfig } from '../hooks/useOptimisticConfig'
import { useAuthState } from '../hooks/useAuthState'
import type { ConfigKey, ConfigValueMap, FontInfo, ProxyStatus } from '@shared/types'
import { AppearanceSettings } from '../components/settings/AppearanceSettings'
import { DownloadSettings } from '../components/settings/DownloadSettings'
import { AuthSettings } from '../components/settings/AuthSettings'
import { ProxySettings } from '../components/settings/ProxySettings'
import { NotificationSettings } from '../components/settings/NotificationSettings'
import { TagFilterSettings } from '../components/settings/TagFilterSettings'
import { Toast } from '../components/common/Toast'
import { CacheSettings } from '../components/settings/CacheSettings'
import { MigrationDialog } from '../components/settings/MigrationDialog'
import { useMigration } from '../hooks/useMigration'

type CardStyle = 'cover' | 'detailed'
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
  defaultSource: string
  previewCacheSizeLimitMB: number
  jmcomicDomain: string
}

interface SettingsPageProps {
  scrollTarget?: string | null
  onScrollDone?: () => void
}

export function SettingsPage({ scrollTarget, onScrollDone }: SettingsPageProps) {
  const { themeMode, cardStyle, sfwMode, setThemeMode, setCardStyle, setSfwMode, tagBlacklist, addTag, removeTag } = useSettingsStore()
  const loginSectionRef = useRef<HTMLDivElement>(null!)
  const { getConfig, setConfig, openDownloadDir, selectDirectory } = useConfig()
  const hcomicAuth = useAuthState('hcomic')
  const jmcomicAuth = useAuthState('jmcomic')
  const { getProxyStatus } = useProxyStatus()
  const { getAvailableFonts } = useAvailableFonts()
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('cbz')
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
    defaultSource: 'hcomic',
    previewCacheSizeLimitMB: 500,
    jmcomicDomain: '',
  })
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [availableFonts, setAvailableFonts] = useState<FontInfo[]>([])
  const [fontName, setFontName] = useState('')
  const [fontSize, setFontSize] = useState(14)
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus | null>(null)
  const [proxyLoading, setProxyLoading] = useState(false)
  const [showLoginToast, setShowLoginToast] = useState(false)
  const [loginToastCountdown, setLoginToastCountdown] = useState<number | null>(null)
  const { createHandler } = useOptimisticConfig(setConfig, setSaveError, setIsSaving)
  const [isMigrationOpen, setIsMigrationOpen] = useState(false)
  const migrationHook = useMigration()
  const [jmcomicDomainInput, setJmcomicDomainInput] = useState('')
  const [jmcomicDomainMode, setJmcomicDomainMode] = useState<'auto' | 'custom'>('auto')

  const SECTIONS = [
    { id: 'appearance', label: '外观设置', icon: '🎨' },
    { id: 'download',   label: '下载设置', icon: '📥' },
    { id: 'source',     label: '来源',     icon: '🌐' },
    { id: 'tag-filter', label: '标签过滤', icon: '🏷️' },
    { id: 'auth',       label: '认证设置', icon: '🔑' },
    { id: 'proxy',      label: '代理设置', icon: '🔌' },
    { id: 'notification', label: '通知设置', icon: '🔔' },
    { id: 'cache',      label: '缓存管理', icon: '💾' },
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
          defaultSource: result.config.defaultSource ?? 'hcomic',
          previewCacheSizeLimitMB: result.config.previewCacheSizeLimitMB ?? 500,
          jmcomicDomain: result.config.jmcomicDomain ?? '',
        })
        setJmcomicDomainInput(result.config.jmcomicDomain ?? '')
        setJmcomicDomainMode(result.config.jmcomicDomain ? 'custom' : 'auto')
        if (result.config.outputFormat) {
          setOutputFormat(result.config.outputFormat as OutputFormat)
        }
        if (result.config.themeMode === 'light' || result.config.themeMode === 'dark' || result.config.themeMode === 'auto') {
          setThemeMode(result.config.themeMode)
        }
        if (result.config.hasAuth) {
          hcomicAuth.verifyFromConfig(true)
        }
        if (result.config.hasJmcomicAuth) {
          jmcomicAuth.verifyFromConfig(true)
        }
        if (result.config.fontName) setFontName(result.config.fontName)
        if (result.config.fontSize) setFontSize(result.config.fontSize)
        if (typeof result.config.previewCacheSizeLimitMB === 'number') {
          setConfigState(prev => ({ ...prev, previewCacheSizeLimitMB: result.config.previewCacheSizeLimitMB }))
        }
      }
    } catch (err) {
      console.error('Failed to load config:', err)
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProxyStatus()
  }, [getAvailableFonts, loadProxyStatus])

  useEffect(() => {
    let countdownTimer: ReturnType<typeof setInterval> | null = null
    let hideTimer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = window.hcomic?.onLoginCookieSuccess(() => {
      setLoginToastCountdown(5)
      setShowLoginToast(true)
      countdownTimer = setInterval(() => {
        setLoginToastCountdown(prev => {
          if (prev === null || prev <= 1) {
            if (countdownTimer) clearInterval(countdownTimer)
            return null
          }
          return prev - 1
        })
      }, 1000)
      hideTimer = setTimeout(() => setShowLoginToast(false), 5500)
    })
    return () => {
      unsubscribe?.()
      if (countdownTimer) clearInterval(countdownTimer)
      if (hideTimer) clearTimeout(hideTimer)
    }
  }, [])

  const handleCancelLoginAutoClose = useCallback(() => {
    window.hcomic?.cancelLoginAutoClose()
    setLoginToastCountdown(null)
    setShowLoginToast(false)
  }, [])

  const handleThemeChange = createHandler('themeMode', () => themeMode, setThemeMode, (prev) => setThemeMode(prev))

  const handleCardStyleChange = (style: CardStyle) => {
    setCardStyle(style)
  }

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
      await setConfig(key, value as ConfigValueMap[ConfigKey])
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

  const handleApplyAuth = async (curlText: string, source: string = 'hcomic') => {
    const auth = source === 'jmcomic' ? jmcomicAuth : hcomicAuth
    await auth.apply(curlText)
  }

  const handleTestAuth = async (source: string = 'hcomic') => {
    const auth = source === 'jmcomic' ? jmcomicAuth : hcomicAuth
    await auth.test()
  }

  const handleOpenLoginWindow = async (source: string = 'hcomic') => {
    const auth = source === 'jmcomic' ? jmcomicAuth : hcomicAuth
    await auth.openWindow(auth.status)
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
      <Toast
        message={loginToastCountdown != null ? `已获取到 Cookie，将在 ${loginToastCountdown} 秒后关闭弹窗` : '已获取到 Cookie'}
        actionLabel="取消"
        onAction={handleCancelLoginAutoClose}
        visible={showLoginToast}
      />
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
                className="h-full bg-[var(--accent)] rounded-full transition-all duration-300"
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
              {['hcomic', 'moeimg'].map((source) => (
                <button
                  key={source}
                  onClick={() => handleConfigChange('defaultSource', source)}
                  className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                    config.defaultSource === source
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]'
                  }`}
                >
                  {source === 'hcomic' ? 'HComic' : 'Moeimg'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">JMComic 域名</label>
            <p className="text-xs text-[var(--text-secondary)] mb-3">
              默认从发布页自动获取可用域名，也可手动指定
            </p>
            <div className="flex gap-3 mb-3">
              <button
                onClick={async () => {
                  setJmcomicDomainMode('auto')
                  setJmcomicDomainInput('')
                  if (config.jmcomicDomain) {
                    handleConfigChange('jmcomicDomain', '')
                  }
                }}
                className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                  jmcomicDomainMode === 'auto'
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]'
                }`}
              >
                自动选择
              </button>
              <button
                onClick={() => setJmcomicDomainMode('custom')}
                className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                  jmcomicDomainMode === 'custom'
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]'
                }`}
              >
                自定义
              </button>
            </div>
            {jmcomicDomainMode === 'custom' && (
              <div className="flex gap-2 items-start">
                <div className="flex-1">
                  <input
                    type="text"
                    value={jmcomicDomainInput}
                    onChange={(e) => {
                      setJmcomicDomainInput(e.target.value)
                    }}
                    onBlur={async () => {
                      const domain = jmcomicDomainInput.trim()
                      if (domain === config.jmcomicDomain) return
                      handleConfigChange('jmcomicDomain', domain)
                    }}
                    onKeyDown={async (e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur()
                      }
                    }}
                    placeholder="例如 18comic.vip"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div id="section-tag-filter">
        <TagFilterSettings
          tagBlacklist={tagBlacklist}
          addTag={addTag}
          removeTag={removeTag}
        />
      </div>

      <div id="section-auth">
        <AuthSettings
          loginSectionRef={loginSectionRef}
          loginStatus={hcomicAuth.status}
          loginMessage={hcomicAuth.message}
          jmcomicLoginStatus={jmcomicAuth.status}
          jmcomicLoginMessage={jmcomicAuth.message}
          onApplyAuth={handleApplyAuth}
          onTestAuth={handleTestAuth}
          onOpenLoginWindow={handleOpenLoginWindow}
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
          onConfigChange={handleConfigChange}
        />
      </div>

      <div id="section-cache">
        <CacheSettings
          sizeLimitMB={config.previewCacheSizeLimitMB}
          onSizeLimitChange={(mb) => handleConfigChange('previewCacheSizeLimitMB', mb)}
        />
      </div>

        <MigrationDialog
          isOpen={isMigrationOpen}
          onClose={() => setIsMigrationOpen(false)}
          currentDownloadDir={config.downloadDir}
          onSelectDirectory={selectDirectory}
        />
      </div>
    </div>
  )
}
