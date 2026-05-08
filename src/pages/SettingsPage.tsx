import { useState, useEffect } from 'react'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useConfig, useProxyStatus, useAvailableFonts } from '../hooks/useIpc'
import { useAuth } from '../hooks/useIpc'
import type { ConfigKey, ConfigValueMap, FontInfo, ProxyStatus } from '@shared/types'

type ThemeMode = 'light' | 'dark' | 'auto'
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
}

export function SettingsPage() {
  const { themeMode, cardStyle, setThemeMode, setCardStyle } = useSettingsStore()
  const { getConfig, setConfig, openDownloadDir } = useConfig()
  const { applyAuth, verifyAuth } = useAuth()
  const { getProxyStatus } = useProxyStatus()
  const { getAvailableFonts } = useAvailableFonts()
  const [curlText, setCurlText] = useState('')
  const [loginStatus, setLoginStatus] = useState<'idle' | 'verifying' | 'valid' | 'invalid' | 'error'>('idle')
  const [loginMessage, setLoginMessage] = useState('')
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
    defaultSource: 'hcomic'
  })
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [availableFonts, setAvailableFonts] = useState<FontInfo[]>([])
  const [fontName, setFontName] = useState('')
  const [fontSize, setFontSize] = useState(14)
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus | null>(null)
  const [proxyLoading, setProxyLoading] = useState(false)

  useEffect(() => {
    loadConfig()
  }, [])

  // ── Load fonts and proxy ──
  useEffect(() => {
    getAvailableFonts().then((result) => setAvailableFonts(result.fonts)).catch(() => {})
    loadProxyStatus()
  }, [])

  const loadProxyStatus = async () => {
    setProxyLoading(true)
    try {
      const result = await getProxyStatus()
      setProxyStatus(result)
    } catch {
      setProxyStatus(null)
    } finally {
      setProxyLoading(false)
    }
  }

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
          defaultSource: result.config.defaultSource ?? 'hcomic'
        })
        if (result.config.outputFormat) {
          setOutputFormat(result.config.outputFormat as OutputFormat)
        }
        if (result.config.themeMode === 'light' || result.config.themeMode === 'dark' || result.config.themeMode === 'auto') {
          setThemeMode(result.config.themeMode)
        }
        // 检查已有登录状态
        if (result.config.hasAuth) {
          setLoginStatus('verifying')
          try {
            const verifyResult = await verifyAuth()
            setLoginStatus(verifyResult.valid ? 'valid' : 'invalid')
            setLoginMessage(verifyResult.message || '')
          } catch {
            setLoginStatus('idle')
          }
        }
        // ── Font config ──
        if (result.config.fontName) setFontName(result.config.fontName)
        if (result.config.fontSize) setFontSize(result.config.fontSize)
      }
    } catch (err) {
      console.error('Failed to load config:', err)
    }
  }

  const handleThemeChange = async (mode: ThemeMode) => {
    setSaveError(null)
    const prev = themeMode
    setThemeMode(mode)
    setIsSaving(true)
    try {
      await setConfig('themeMode', mode)
    } catch (err: any) {
      setThemeMode(prev)
      setSaveError(err?.message || '保存失败')
      setTimeout(() => setSaveError(null), 5000)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCardStyleChange = (style: CardStyle) => {
    setCardStyle(style)
  }

  const handleOutputFormatChange = async (format: OutputFormat) => {
    setSaveError(null)
    const prev = outputFormat
    setOutputFormat(format)
    setIsSaving(true)
    try {
      await setConfig('outputFormat', format)
    } catch (err: any) {
      setOutputFormat(prev)
      setSaveError(err?.message || '保存失败')
      setTimeout(() => setSaveError(null), 5000)
    } finally {
      setIsSaving(false)
    }
  }

  const handleConfigChange = async (key: ConfigKey, value: ConfigValueMap[ConfigKey]) => {
    setSaveError(null)
    const prevValue = (config as any)[key]
    setConfigState(prev => ({ ...prev, [key]: value }))
    setIsSaving(true)
    try {
      await setConfig(key, value)
    } catch (err: any) {
      setConfigState(prev => ({ ...prev, [key]: prevValue }))
      setSaveError(err?.message || '保存失败')
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
    const value = (config as any)[key]
    setIsSaving(true)
    try {
      await setConfig(key, value)
    } catch (err: any) {
      // 从后端重新加载上一个有效值
      try {
        const result = await getConfig()
        if (result.config) {
          const restored = (result.config as any)[key]
          if (restored !== undefined) {
            setConfigState(prev => ({ ...prev, [key]: restored }))
          }
        }
      } catch { /* reload 也失败则只显示错误 */ }
      setSaveError(err?.message || '保存失败')
      setTimeout(() => setSaveError(null), 5000)
    } finally {
      setIsSaving(false)
    }
  }

  const handleApplyAuth = async () => {
    if (!curlText.trim()) return
    setLoginStatus('verifying')
    setLoginMessage('')
    try {
      await applyAuth(curlText.trim())
      const verifyResult = await verifyAuth()
      setLoginStatus(verifyResult.valid ? 'valid' : 'invalid')
      setLoginMessage(verifyResult.message || '')
      setCurlText('')
    } catch (err: any) {
      setLoginStatus('error')
      setLoginMessage(err.message || '操作失败')
    }
  }

  const handleTestAuth = async () => {
    setLoginStatus('verifying')
    setLoginMessage('')
    try {
      const verifyResult = await verifyAuth()
      setLoginStatus(verifyResult.valid ? 'valid' : 'invalid')
      setLoginMessage(verifyResult.message || '')
    } catch (err: any) {
      setLoginStatus('error')
      setLoginMessage(err.message || '验证失败')
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
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

      <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm space-y-6">
        <h3 className="text-base font-medium text-[var(--text-primary)] border-b border-[var(--border)] pb-3">
          外观
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">主题</label>
            <div className="flex gap-3">
              {(['light', 'dark', 'auto'] as ThemeMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => handleThemeChange(mode)}
                  className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                    themeMode === mode
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]'
                  }`}
                >
                  {mode === 'light' ? '浅色' : mode === 'dark' ? '深色' : '跟随系统'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">卡片样式</label>
            <div className="flex gap-3">
              {(['cover', 'detailed'] as CardStyle[]).map((style) => (
                <button
                  key={style}
                  onClick={() => handleCardStyleChange(style)}
                  className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                    cardStyle === style
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]'
                  }`}
                >
                  {style === 'cover' ? '封面 + 标题' : '详细列表'}
                </button>
              ))}
            </div>
          </div>

          {/* ── Font selection ── */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">字体</label>
            <select
              value={fontName}
              onChange={async (e) => {
                const name = e.target.value
                setFontName(name)
                setSaveError(null)
                setIsSaving(true)
                try {
                  await setConfig('fontName', name)
                  document.documentElement.style.setProperty('--app-font-family', name)
                } catch (err: any) {
                  setSaveError(err?.message || '保存失败')
                } finally {
                  setIsSaving(false)
                }
              }}
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                         text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]"
            >
              {availableFonts.map((f) => (
                <option key={f.name} value={f.name}>{f.label}</option>
              ))}
            </select>
          </div>

          {/* ── Font size ── */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
              字体大小 ({fontSize}px)
            </label>
            <input
              type="range"
              min="12"
              max="20"
              value={fontSize}
              onChange={async (e) => {
                const size = parseInt(e.target.value)
                setFontSize(size)
                setIsSaving(true)
                try {
                  await setConfig('fontSize', size)
                  document.documentElement.style.setProperty('--app-font-size', `${size}px`)
                } catch (err: any) {
                  setSaveError(err?.message || '保存失败')
                } finally {
                  setIsSaving(false)
                }
              }}
              className="w-full"
            />
          </div>
        </div>
      </div>

      <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm space-y-6">
        <h3 className="text-base font-medium text-[var(--text-primary)] border-b border-[var(--border)] pb-3">
          下载
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">输出格式</label>
            <div className="flex gap-3">
              {(['folder', 'zip', 'cbz'] as OutputFormat[]).map((format) => (
                <button
                  key={format}
                  onClick={() => handleOutputFormatChange(format)}
                  className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                    outputFormat === format
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]'
                  }`}
                >
                  {format.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">下载目录</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={config.downloadDir}
                onChange={(e) => handleTextConfigChange('downloadDir', e.target.value)}
                onBlur={() => handleTextConfigBlur('downloadDir')}
                placeholder="请输入下载目录的绝对路径"
                className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                           text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]"
              />
              <button
                onClick={async () => {
                  try { await openDownloadDir() } catch (err: any) {
                    setSaveError(err?.message || '打开目录失败')
                  }
                }}
                className="px-3 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                           text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] whitespace-nowrap"
              >
                打开
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                并发下载数 ({config.concurrentDownloads})
              </label>
              <input
                type="range"
                min="1"
                max="10"
                value={config.concurrentDownloads}
                onChange={(e) => handleConfigChange('concurrentDownloads', parseInt(e.target.value))}
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                超时时间 ({config.timeout}秒)
              </label>
              <input
                type="range"
                min="5"
                max="120"
                value={config.timeout}
                onChange={(e) => handleConfigChange('timeout', parseInt(e.target.value))}
                className="w-full"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                重试次数 ({config.retryTimes})
              </label>
              <input
                type="range"
                min="0"
                max="5"
                value={config.retryTimes}
                onChange={(e) => handleConfigChange('retryTimes', parseInt(e.target.value))}
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                批量下载延迟 ({config.batchDownloadDelay}秒)
              </label>
              <input
                type="range"
                min="0"
                max="10"
                value={config.batchDownloadDelay}
                onChange={(e) => handleConfigChange('batchDownloadDelay', parseInt(e.target.value))}
                className="w-full"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">CBZ 文件名模板</label>
            <input
              type="text"
              value={config.cbzFilenameTemplate}
              onChange={(e) => handleTextConfigChange('cbzFilenameTemplate', e.target.value)}
              onBlur={() => handleTextConfigBlur('cbzFilenameTemplate')}
              placeholder="{author}-{title}.cbz"
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                         text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]"
            />
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              可用变量: {'{author}'}, {'{title}'}, {'{id}'}
            </p>
          </div>
        </div>
      </div>

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
      </div>

      <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm space-y-6">
        <h3 className="text-base font-medium text-[var(--text-primary)] border-b border-[var(--border)] pb-3">
          登录
        </h3>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--text-primary)]">HComic</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              loginStatus === 'valid' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
              loginStatus === 'invalid' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' :
              loginStatus === 'verifying' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' :
              loginStatus === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' :
              'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
            }`}>
              {loginStatus === 'valid' ? '有效' :
               loginStatus === 'invalid' ? '失效' :
               loginStatus === 'verifying' ? '验证中...' :
               loginStatus === 'error' ? '错误' : '未配置'}
            </span>
          </div>

          <div>
            <textarea
              value={curlText}
              onChange={(e) => setCurlText(e.target.value)}
              placeholder={`从浏览器获取 curl 命令：\n1. 打开 h-comic.com 并登录\n2. F12 → Network → 右键任意请求 → Copy as cURL\n3. 粘贴到此处`}
              rows={4}
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                         text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]
                         resize-none font-mono"
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleApplyAuth}
              disabled={!curlText.trim() || loginStatus === 'verifying'}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
                         bg-[var(--accent)] text-white hover:opacity-90
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              应用登录信息
            </button>
            <button
              onClick={handleTestAuth}
              disabled={loginStatus === 'verifying'}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
                         bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loginStatus === 'verifying' ? '测试中...' : '测试登录'}
            </button>
            <button
              onClick={() => window.hcomic?.openUrl('https://h-comic.com')}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
                         bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]"
            >
              打开网站登录
            </button>
          </div>

          {loginMessage && (
            <p className={`text-xs ${
              loginStatus === 'valid' ? 'text-green-600 dark:text-green-400' :
              loginStatus === 'invalid' ? 'text-red-600 dark:text-red-400' :
              'text-[var(--text-secondary)]'
            }`}>
              {loginMessage}
            </p>
          )}
        </div>
      </div>

      {/* ── Proxy status ── */}
      <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm space-y-4">
        <h3 className="text-base font-medium text-[var(--text-primary)] border-b border-[var(--border)] pb-3">
          系统代理
        </h3>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-[var(--text-secondary)] w-16 flex-shrink-0">HTTP:</span>
            <span className="text-[var(--text-primary)]">{proxyStatus?.http || '未检测到'}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-[var(--text-secondary)] w-16 flex-shrink-0">HTTPS:</span>
            <span className="text-[var(--text-primary)]">{proxyStatus?.https || '未检测到'}</span>
          </div>
          <button
            onClick={loadProxyStatus}
            disabled={proxyLoading}
            className="px-3 py-1 text-sm rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                       text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
          >
            {proxyLoading ? '检测中...' : '刷新代理'}
          </button>
        </div>
      </div>

      <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm space-y-6">
        <h3 className="text-base font-medium text-[var(--text-primary)] border-b border-[var(--border)] pb-3">
          通知
        </h3>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-[var(--text-primary)]">下载完成通知</label>
            <button
              onClick={() => handleConfigChange('notifyOnComplete', !config.notifyOnComplete)}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                config.notifyOnComplete ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
              }`}
            >
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                config.notifyOnComplete ? 'left-7' : 'left-1'
              }`} />
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">前台通知</label>
            <div className="flex gap-3">
              {(['inactive', 'always'] as NotifyWhenForeground[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => handleConfigChange('notifyWhenForeground', mode)}
                  className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                    config.notifyWhenForeground === mode
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]'
                  }`}
                >
                  {mode === 'inactive' ? '仅后台时' : '始终通知'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
