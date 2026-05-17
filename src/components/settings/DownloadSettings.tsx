import type { ConfigKey } from '@shared/types'

type OutputFormat = 'folder' | 'zip' | 'cbz'

interface DownloadSettingsProps {
  outputFormat: OutputFormat
  config: {
    downloadDir: string
    concurrentDownloads: number
    timeout: number
    retryTimes: number
    cbzFilenameTemplate: string
    batchDownloadDelay: number
  }
  onOutputFormatChange: (format: OutputFormat) => void
  onConfigChange: (key: ConfigKey, value: unknown) => void
  onTextConfigChange: (key: ConfigKey, value: string) => void
  onTextConfigBlur: (key: ConfigKey) => void
  openDownloadDir: () => Promise<{ success: boolean }>
  onSelectDirectory: () => Promise<void>
  setSaveError: (err: string | null) => void
  onOpenMigration: () => void
}

export function DownloadSettings({
  outputFormat,
  config,
  onOutputFormatChange,
  onConfigChange,
  onTextConfigChange,
  onTextConfigBlur,
  openDownloadDir,
  onSelectDirectory,
  setSaveError,
  onOpenMigration,
}: DownloadSettingsProps) {
  return (
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
                onClick={() => onOutputFormatChange(format)}
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
              onChange={(e) => onTextConfigChange('downloadDir', e.target.value)}
              onBlur={() => onTextConfigBlur('downloadDir')}
              placeholder="请输入下载目录的绝对路径"
              className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                         text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]"
            />
            <button
              onClick={onSelectDirectory}
              className="px-3 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                         text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] whitespace-nowrap"
            >
              浏览
            </button>
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
          <div className="mt-2">
            <button
              onClick={onOpenMigration}
              className="px-3 py-1.5 text-sm rounded-lg border border-[var(--accent)] text-[var(--accent)]
                         hover:bg-[var(--accent)] hover:text-white transition-colors"
            >
              迁移漫画库
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
              onChange={(e) => onConfigChange('concurrentDownloads', parseInt(e.target.value))}
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
              onChange={(e) => onConfigChange('timeout', parseInt(e.target.value))}
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
              onChange={(e) => onConfigChange('retryTimes', parseInt(e.target.value))}
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
              onChange={(e) => onConfigChange('batchDownloadDelay', parseInt(e.target.value))}
              className="w-full"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">CBZ 文件名模板</label>
          <input
            type="text"
            value={config.cbzFilenameTemplate}
            onChange={(e) => onTextConfigChange('cbzFilenameTemplate', e.target.value)}
            onBlur={() => onTextConfigBlur('cbzFilenameTemplate')}
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
  )
}
