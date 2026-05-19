import { useDownloadStore } from '../stores/useDownloadStore'

interface StatusBarProps {
  onNavigateToDownloads?: () => void
}

export function StatusBar({ onNavigateToDownloads }: StatusBarProps) {
  const tasks = useDownloadStore((s) => s.tasks)
  const activeTasks = tasks.filter((t) => t.status === 'downloading' || t.status === 'queued' || t.status === 'pausing')
  const downloadingTask = tasks.find((t) => t.status === 'downloading')
  const totalActive = activeTasks.length

  if (totalActive === 0 && !downloadingTask) return null

  return (
    <div
      onClick={onNavigateToDownloads}
      className={`fixed bottom-0 left-16 right-0 h-10 bg-[var(--bg-primary)] border-t border-[var(--border)]
                 flex items-center px-4 gap-4 cursor-pointer z-40
                 ${onNavigateToDownloads ? 'hover:bg-[var(--bg-secondary)]' : ''}`}
    >
      <span className="text-xs text-[var(--text-secondary)] flex-shrink-0">
        下载中: {totalActive} 个任务
      </span>
      {downloadingTask && (
        <>
          <div className="flex-1 h-2 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--accent)] rounded-full transition-all duration-300"
              style={{ width: `${Math.min(downloadingTask.progress || 0, 100)}%` }}
            />
          </div>
          <span className="text-xs text-[var(--text-primary)] flex-shrink-0 min-w-0 truncate max-w-[200px]">
            {downloadingTask.comic.title}
          </span>
          <span className="text-xs text-[var(--text-secondary)] flex-shrink-0">
            {downloadingTask.downloadedPages || 0} / {downloadingTask.totalPages || 0}
          </span>
        </>
      )}
    </div>
  )
}