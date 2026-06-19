import type { DownloadStatus } from '@shared/types'

interface ProgressBarProps {
  progress: number
  status: DownloadStatus
  totalPages: number
  downloadedPages: number
  className?: string
}

const statusColors: Record<DownloadStatus, string> = {
  queued: 'var(--warning)',
  downloading: 'var(--accent)',
  pausing: 'var(--warning)',
  paused: 'var(--warning)',
  completed: 'var(--success)',
  failed: 'var(--error)',
  cancelled: 'var(--text-secondary)',
}

const statusLabels: Record<DownloadStatus, string> = {
  queued: '排队中',
  downloading: '下载中',
  pausing: '暂停中',
  paused: '已暂停',
  completed: '完成',
  failed: '失败',
  cancelled: '已取消',
}

export function ProgressBar({ progress, status, totalPages, downloadedPages, className = '' }: ProgressBarProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="flex-1 h-2 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-slow"
          style={{
            width: `${progress}%`,
            backgroundColor: statusColors[status]
          }}
        />
      </div>
      <span
        className="text-xs font-medium px-2 py-0.5 rounded-full"
        style={{
          backgroundColor: `${statusColors[status]}20`,
          color: statusColors[status]
        }}
      >
        {status === 'downloading' ? `${downloadedPages} / ${totalPages}` : statusLabels[status]}
      </span>
    </div>
  )
}
