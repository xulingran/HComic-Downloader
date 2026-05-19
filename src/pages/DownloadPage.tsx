import { useEffect, useState } from 'react'
import { useDownloadStore } from '../stores/useDownloadStore'
import { useDownload } from '../hooks/useIpc'
import { useDownloadHelper } from '../hooks/useDownloadHelper'
import { ProgressBar } from '../components/common/ProgressBar'
import type { DownloadStatus, DownloadDetail } from '@shared/types'

type StatusFilter = 'all' | 'active' | 'completed' | 'failed' | 'paused'

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '进行中' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失败' },
  { value: 'paused', label: '已暂停' },
]

function matchStatusFilter(status: DownloadStatus, filter: StatusFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'active') return status === 'downloading' || status === 'queued' || status === 'pausing'
  return status === filter
}

export function DownloadPage() {
  const { tasks, setTasks, updateTask, isGloballyPaused } = useDownloadStore()
  const { getDownloads, cancelDownload, progress } = useDownload()
  const { handlePauseTask, handleResumeTask, handleRetryTask, handleToggleGlobalPause } = useDownloadHelper()
  const [failedDialog, setFailedDialog] = useState<DownloadDetail | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  useEffect(() => {
    loadDownloads()
  }, [])

  useEffect(() => {
    const currentTasks = useDownloadStore.getState().tasks
    for (const [taskId, data] of Object.entries(progress)) {
      const existingTask = currentTasks.find((t) => t.id === taskId)
      if (!existingTask) {
        // 任务不在当前列表中（可能在页面加载前就已启动），跳过
        // 完整任务列表由 loadDownloads() 负责加载
        continue
      }
      updateTask(taskId, {
        status: data.status as DownloadStatus,
        progress: data.progress,
        totalPages: data.total,
        downloadedPages: data.current,
      })
      // ── Detect failure transitions ──
      if (data.status === 'failed' && existingTask.status !== 'failed') {
        window.hcomic?.getDownloadDetail(taskId).then((detail) => setFailedDialog(detail)).catch(() => {})
      }
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

  const handleRefresh = async () => {
    await loadDownloads()
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
          {tasks.length > 0 && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="px-2 py-1 text-sm rounded-lg bg-[var(--bg-primary)] border border-[var(--border)]
                         text-[var(--text-primary)]"
            >
              {STATUS_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          )}
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
            onClick={handleRefresh}
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
          {statusFilter !== 'all' && (
            <div className="text-xs text-[var(--text-secondary)]">
              显示 {tasks.filter(t => matchStatusFilter(t.status, statusFilter)).length} / {tasks.length} 个任务
            </div>
          )}
          {tasks.filter(t => matchStatusFilter(t.status, statusFilter)).map((task) => (
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
                  {task.status === 'pausing' && (
                    <>
                      <span className="text-xs px-2 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
                        暂停中
                      </span>
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
                </div>
              </div>
              <ProgressBar progress={task.progress} status={task.status} totalPages={task.totalPages} downloadedPages={task.downloadedPages} />
              {task.error && (
                <p className="text-xs text-[var(--error)] mt-2">{task.error}</p>
              )}
            </div>
          ))}
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


