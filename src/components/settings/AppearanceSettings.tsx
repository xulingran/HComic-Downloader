import type { FontInfo } from '@shared/types'

type ThemeMode = 'light' | 'dark' | 'auto'
type CardStyle = 'cover' | 'detailed'

interface AppearanceSettingsProps {
  themeMode: ThemeMode
  cardStyle: CardStyle
  sfwMode: boolean
  availableFonts: FontInfo[]
  fontName: string
  fontSize: number
  onThemeChange: (mode: ThemeMode) => void
  onCardStyleChange: (style: CardStyle) => void
  onSfwModeChange: (enabled: boolean) => void
  onFontNameChange: (name: string) => void
  onFontSizeChange: (size: number) => void
  setConfig: (key: 'fontName' | 'fontSize', value: string | number) => Promise<{ success: boolean }>
  setSaveError: (err: string | null) => void
  setIsSaving: (saving: boolean) => void
}

export function AppearanceSettings({
  themeMode,
  cardStyle,
  sfwMode,
  availableFonts,
  fontName,
  fontSize,
  onThemeChange,
  onCardStyleChange,
  onSfwModeChange,
  onFontNameChange,
  onFontSizeChange,
  setConfig,
  setSaveError,
  setIsSaving,
}: AppearanceSettingsProps) {
  return (
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
                onClick={() => onThemeChange(mode)}
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
                onClick={() => onCardStyleChange(style)}
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
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">SFW 模式</label>
          <div className="flex gap-3">
            <button
              onClick={() => onSfwModeChange(true)}
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                sfwMode
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]'
              }`}
            >
              开启
            </button>
            <button
              onClick={() => onSfwModeChange(false)}
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                !sfwMode
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]'
              }`}
            >
              关闭
            </button>
          </div>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            开启后所有漫画封面将替换为占位符
          </p>
        </div>

        {/* ── Font selection ── */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">字体</label>
          <select
            value={fontName}
            onChange={async (e) => {
              const name = e.target.value
              onFontNameChange(name)
              setSaveError(null)
              setIsSaving(true)
              try {
                await setConfig('fontName', name)
                document.documentElement.style.setProperty('--app-font-family', name)
              } catch (err: unknown) {
                setSaveError((err instanceof Error ? err.message : '') || '保存失败')
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
              onFontSizeChange(size)
              setIsSaving(true)
              try {
                await setConfig('fontSize', size)
                document.documentElement.style.setProperty('--app-font-size', `${size}px`)
              } catch (err: unknown) {
                setSaveError((err instanceof Error ? err.message : '') || '保存失败')
              } finally {
                setIsSaving(false)
              }
            }}
            className="w-full"
          />
        </div>
      </div>
    </div>
  )
}
