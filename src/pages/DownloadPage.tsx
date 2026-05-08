import { useEffect } from 'react'
import { useDownloadStore } from '../stores/useDownloadStore'
import { useDownload } from '../hooks/useIpc'
import { ProgressBar } from '../components/common/ProgressBar'

export function DownloadPage() {
  const { tasks, setTasks, updateTask } = useDownloadStore()
  const { getDownloads, cancelDownload, progress } = useDownload()

  useEffect(() => {
    loadDownloads()
  }, [])

  useEffect(() => {
    for (const [taskId, data] of Object.entries(progress)) {
      updateTask(taskId, {
        progress: data.progress,
        downloadedPages: data.current,
        totalPages: data.total,
        status: data.status,
      })
    }
  }, [progress, updateTask])

  const loadDownloads = async () => {
    try {
      const result = await getDownloads()
      setTasks(result.tasks)
    } catch (err) {
      console.error('Failed to load downloads:', err)
    }
  }

  const handleCancel = async (taskId: string) => {
    try {
      await cancelDownload(taskId)
      updateTask(taskId, { status: 'cancelled' })
    } catch (err) {
      console.error('Failed to cancel download:', err)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          下载管理
        </h2>
        <button
          onClick={loadDownloads}
          className="px-3 py-1 text-sm bg-[var(--bg-primary)] border border-[var(--border)] 
                     rounded-lg hover:bg-[var(--bg-secondary)] transition-colors"
        >
          刷新
        </button>
      </div>

      {tasks.length === 0 ? (
        <div className="text-center text-[var(--text-secondary)] py-12">
          暂无下载任务
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="bg-[var(--bg-primary)] rounded-xl p-4 shadow-sm"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-[var(--text-primary)]">
                  {task.comic.title}
                </h3>
                {task.status === 'downloading' && (
                  <button
                    onClick={() => handleCancel(task.id)}
                    className="text-xs text-[var(--error)] hover:underline"
                  >
                    取消
                  </button>
                )}
              </div>
              <ProgressBar progress={task.progress} status={task.status} />
              {task.error && (
                <p className="text-xs text-[var(--error)] mt-2">{task.error}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
