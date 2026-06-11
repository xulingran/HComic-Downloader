import type { ConfigKey } from '@shared/types'

type NotifyWhenForeground = 'inactive' | 'always'

interface NotificationSettingsProps {
  notifyOnComplete: boolean
  notifyWhenForeground: NotifyWhenForeground
  checkUpdateOnStart: boolean
  onConfigChange: (key: ConfigKey, value: unknown) => void
}

export function NotificationSettings({
  notifyOnComplete,
  notifyWhenForeground,
  checkUpdateOnStart,
  onConfigChange,
}: NotificationSettingsProps) {
  return (
    <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm space-y-6">
      <h3 className="text-base font-medium text-[var(--text-primary)] border-b border-[var(--border)] pb-3">
        通知
      </h3>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-[var(--text-primary)]">下载完成通知</label>
          <button
            onClick={() => onConfigChange('notifyOnComplete', !notifyOnComplete)}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              notifyOnComplete ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
            }`}
          >
            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
              notifyOnComplete ? 'left-7' : 'left-1'
            }`} />
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">前台通知</label>
          <div className="flex gap-3">
            {(['inactive', 'always'] as NotifyWhenForeground[]).map((mode) => (
              <button
                key={mode}
                onClick={() => onConfigChange('notifyWhenForeground', mode)}
                className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                  notifyWhenForeground === mode
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]'
                }`}
              >
                {mode === 'inactive' ? '仅后台时' : '始终通知'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <label className="text-sm font-medium text-[var(--text-primary)]">启动时检查更新</label>
          <button
            onClick={() => onConfigChange('checkUpdateOnStart', !checkUpdateOnStart)}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              checkUpdateOnStart ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
            }`}
          >
            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
              checkUpdateOnStart ? 'left-7' : 'left-1'
            }`} />
          </button>
        </div>
      </div>
    </div>
  )
}
