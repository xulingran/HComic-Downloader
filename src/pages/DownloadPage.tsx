import { useEffect, useState } from 'react'
import { useDownloadStore } from '../stores/useDownloadStore'
import { useDownload } from '../hooks/useIpc'
import { useDownloadHelper } from '../hooks/useDownloadHelper'
import { ProgressBar } from '../components/common/ProgressBar'
import type { DownloadStatus, DownloadDetail } from '@shared/types'

export function DownloadPage() {
  const { tasks, setTasks, addTask, updateTask, isGloballyPaused } = useDownloadStore()
  const { getDownloads, cancelDownload, progress } = useDownload()
  const { handlePauseTask, handleResumeTask, handleRetryTask, handleToggleGlobalPause } = useDownloadHelper()
  const [completedDialog, setCompletedDialog] = useState<DownloadDetail | null>(null)
  const [failedDialog, setFailedDialog] = useState<DownloadDetail | null>(null)

  useEffect(() => {
    loadDownloads()
  }, [])

  useEffect(() => {
    const currentTasks = useDownloadStore.getState().tasks
    for (const [taskId, data] of Object.entries(progress)) {
      const existingTask = currentTasks.find((t) => t.id === taskId)
      if (existingTask) {
        updateTask(taskId, {
          status: data.status as DownloadStatus,
          progress: data.progress,
          totalPages: data.total,
          downloadedPages: data.current,
        })
        // ── Detect completion / failure transitions ──
        if (data.status === 'completed' && existingTask.status !== 'completed') {
          window.hcomic?.getDownloadDetail(taskId).then((detail) => setCompletedDialog(detail)).catch(() => {})
        }
        if (data.status === 'failed' && existingTask.status !== 'failed') {
          window.hcomic?.getDownloadDetail(taskId).then((detail) => setFailedDialog(detail)).catch(() => {})
        }
      } else {
        addTask({
          id: taskId,
          comic: { id: taskId, title: data.title || '', url: '', coverUrl: '', source: '' },
          status: data.status as DownloadStatus,
          progress: data.progress,
          totalPages: data.total,
          downloadedPages: data.current,
        })
      }
    }
  }, [progress, addTask, updateTask])

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
        <div className="flex gap-2">
          <button
            onClick={handleToggleGlobalPause}
            className={`px-3 py-1 text-sm rounded-lg transition-colors
                       ${isGloballyPaused
                         ? 'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]'
                         : 'bg-[var(--bg-primary)] border border-[var(--border)] hover:bg-[var(--bg-secondary)]'}`}
          >
            {isGloballyPaused ? '▶ 恢复' : '⏸ 暂停'}
          </button>
          <button
            onClick={loadDownloads}
            className="px-3 py-1 text-sm bg-[var(--bg-primary)] border border-[var(--border)] 
                       rounded-lg hover:bg-[var(--bg-secondary)] transition-colors"
          >
            刷新
          </button>
        </div>
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
                <h3 className="text-sm font-medium text-[var(--text-primary)] flex-1 min-w-0 truncate">
                  {task.comic.title}
                </h3>
                <div className="flex gap-1.5 flex-shrink-0 ml-2">
                  {(task.status === 'downloading' || task.status === 'queued') && (
                    <>
                      <button
                        onClick={() => handlePauseTask(task.id)}
                        className="text-xs px-2 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)]
                                   text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                      >
                        暂停
                      </button>
                      <button
                        onClick={() => handleCancel(task.id)}
                        className="text-xs px-2 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)]
                                   text-[var(--error)] hover:bg-[var(--bg-tertiary)]"
                      >
                        取消
                      </button>
                    </>
                  )}
                  {task.status === 'paused' && (
                    <>
                      <button
                        onClick={() => handleResumeTask(task.id)}
                        className="text-xs px-2 py-0.5 rounded bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
                      >
                        恢复
                      </button>
                      <button
                        onClick={() => handleCancel(task.id)}
                        className="text-xs px-2 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)]
                                   text-[var(--error)] hover:bg-[var(--bg-tertiary)]"
                      >
                        取消
                      </button>
                    </>
                  )}
                  {task.status === 'failed' && (
                    <button
                      onClick={() => handleRetryTask(task.id)}
                      className="text-xs px-2 py-0.5 rounded bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
                    >
                      重试
                    </button>
                  )}
                  {task.status === 'downloading' && (
                    <button
                      onClick={() => handleCancel(task.id)}
                      className="hidden"
                    />
                  )}
                </div>
              </div>
              <ProgressBar progress={task.progress} status={task.status} />
              {task.error && (
                <p className="text-xs text-[var(--error)] mt-2">{task.error}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Completed dialog ── */}
      {completedDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setCompletedDialog(null)}>
          <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-lg max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">下载完成</h3>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              文件已保存至: {completedDialog.outputPath || completedDialog.tempDir}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCompletedDialog(null)}
                className="px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)]"
              >
                关闭
              </button>
              {completedDialog.outputPath && (
                <button
                  onClick={() => { window.hcomic?.openDownloadDir(); setCompletedDialog(null) }}
                  className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white"
                >
                  打开文件夹
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Failed dialog ── */}
      {failedDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setFailedDialog(null)}>
          <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-lg max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-medium text-[var(--error)] mb-2">下载失败</h3>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              {failedDialog.errorMessage || '未知错误'}
            </p>
            {failedDialog.tempDir && (
              <p className="text-xs text-[var(--text-secondary)] mb-4">
                临时文件目录: {failedDialog.tempDir}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setFailedDialog(null)}
                className="px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)]"
              >
                关闭
              </button>
              <button
                onClick={() => {
                  handleRetryTask(failedDialog.taskId)
                  setFailedDialog(null)
                }}
                className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white"
              >
                重试
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
