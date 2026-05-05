import { useState, useEffect } from 'react'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useConfig } from '../hooks/useIpc'

type ThemeMode = 'light' | 'dark' | 'auto'
type CardStyle = 'cover' | 'detailed'
type OutputFormat = 'folder' | 'zip' | 'cbz'

export function SettingsPage() {
  const { themeMode, cardStyle, setThemeMode, setCardStyle } = useSettingsStore()
  const { getConfig, setConfig } = useConfig()
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('cbz')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      const result = await getConfig()
      if (result.config.outputFormat) {
        setOutputFormat(result.config.outputFormat as OutputFormat)
      }
    } catch (err) {
      console.error('Failed to load config:', err)
    }
  }

  const handleThemeChange = async (mode: ThemeMode) => {
    setThemeMode(mode)
    await saveConfig('themeMode', mode)
  }

  const handleCardStyleChange = async (style: CardStyle) => {
    setCardStyle(style)
    await saveConfig('cardStyle', style)
  }

  const handleOutputFormatChange = async (format: OutputFormat) => {
    setOutputFormat(format)
    await saveConfig('outputFormat', format)
  }

  const saveConfig = async (key: string, value: any) => {
    setIsSaving(true)
    try {
      await setConfig(key, value)
    } catch (err) {
      console.error('Failed to save config:', err)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-8">
      <h2 className="text-lg font-semibold text-[var(--text-primary)]">
        设置
      </h2>

      <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm space-y-6">
        <div>
          <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3">
            主题
          </h3>
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
          <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3">
            卡片样式
          </h3>
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

        <div>
          <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3">
            输出格式
          </h3>
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
      </div>

      {isSaving && (
        <div className="text-sm text-[var(--text-secondary)]">
          保存中...
        </div>
      )}
    </div>
  )
}
