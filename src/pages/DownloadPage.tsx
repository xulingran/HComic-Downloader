import { useEffect, useState, useMemo } from 'react'
import { useDownloadStore } from '../stores/useDownloadStore'
import { useToastStore } from '../stores/useToastStore'
import { useDownload, useAlbumProgress, useAlbumCommands, useConfig } from '../hooks/useIpc'
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
  const { getConfig, openDownloadDir } = useConfig()
  const [failedDialog, setFailedDialog] = useState<DownloadDetail | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const { forcePackAlbum } = useAlbumCommands()
  const { albumProgress } = useAlbumProgress()
  const [downloadDir, setDownloadDir] = useState('')

  // 专辑分组：按 (sourceSite, albumId) 分组多章专辑任务
  const albumGroups = useMemo(() => {
    const groups = new Map<string, {
      albumId: string
      sourceSite: string
      albumTitle: string
      tasks: typeof tasks
      totalChapters: number
    }>()
    for (const task of tasks) {
      const albumId = task.comic.albumId
      const total = task.comic.albumTotalChapters ?? 1
      if (!albumId || total <= 1) continue
      const key = `${task.comic.sourceSite ?? 'hcomic'}_${albumId}`
      if (!groups.has(key)) {
        groups.set(key, {
          albumId,
          sourceSite: task.comic.sourceSite ?? 'hcomic',
          albumTitle: task.comic.albumTitle ?? task.comic.title,
          tasks: [],
          totalChapters: total,
        })
      }
      groups.get(key)!.tasks.push(task)
    }
    return groups
  }, [tasks])

  // 分离：哪些 task 属于专辑，哪些是独立任务
  const albumTaskIds = useMemo(() => {
    const ids = new Set<string>()
    for (const g of albumGroups.values()) {
      for (const t of g.tasks) ids.add(t.id)
    }
    return ids
  }, [albumGroups])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    loadDownloads()
    getConfig().then((result) => setDownloadDir(result.config?.downloadDir ?? '')).catch((err) => {
      console.error('Failed to load config:', err)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      useToastStore.getState().error('加载下载列表失败')
    }
  }

  const handleOpenDir = async () => {
    if (!downloadDir) return
    try {
      await openDownloadDir(downloadDir)
    } catch (err: unknown) {
      useToastStore.getState().error((err instanceof Error ? err.message : '') || '打开目录失败')
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
      useToastStore.getState().error('取消下载失败')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-[var(--text-primary)] flex-shrink-0">
          下载管理
        </h2>
        {downloadDir && (
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] bg-[var(--bg-primary)] rounded-lg px-3 py-1.5 border border-[var(--border)] min-w-0">
            <span className="text-[var(--text-secondary)] flex-shrink-0">📂 下载目录:</span>
            <span className="truncate" title={downloadDir}>{downloadDir}</span>
            <button
              onClick={handleOpenDir}
              className="px-2 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)]
                         text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] whitespace-nowrap transition-colors flex-shrink-0"
            >
              打开
            </button>
          </div>
        )}
        <div className="flex gap-2 flex-shrink-0 ml-auto">
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
              显示 {(() => {
                const filteredStandalone = tasks.filter(t => !albumTaskIds.has(t.id) && matchStatusFilter(t.status, statusFilter)).length
                const filteredAlbums = [...albumGroups.values()].filter(g => g.tasks.some(t => matchStatusFilter(t.status, statusFilter))).length
                const total = filteredAlbums + filteredStandalone
                return `${total} / ${tasks.length} 个任务`
              })()}
            </div>
          )}

          {/* 专辑卡 */}
          {[...albumGroups.entries()].map(([key, group]) => {
            const completed = group.tasks.filter(t => t.status === 'completed').length
            const hasFailures = group.tasks.some(t => t.status === 'failed')
            const ap = albumProgress[key]
            const isPacked = ap?.event === 'packed'

            return (
              <div key={key} className="bg-[var(--bg-primary)] rounded-xl p-4 shadow-sm border-l-4 border-[var(--accent)]">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {group.albumTitle}
                  </h3>
                  <div className="flex gap-1.5 flex-shrink-0 ml-2">
                    {!isPacked && completed > 0 && (
                      <button
                        onClick={() => forcePackAlbum(group.sourceSite, group.albumId)}
                        className="text-xs px-2 py-0.5 rounded bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
                      >
                        强制打包
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-xs text-[var(--text-secondary)] mb-2">
                  {isPacked ? '已打包' : `${completed}/${group.totalChapters} 章完成`}
                  {hasFailures && ' (有失败)'}
                </div>
                <ProgressBar
                  progress={Math.round((completed / group.totalChapters) * 100)}
                  status={isPacked ? 'completed' : 'downloading'}
                  totalPages={group.totalChapters}
                  downloadedPages={completed}
                />
                {/* 章节子行 */}
                <div className="mt-2 space-y-1">
                  {group.tasks.map(task => (
                    <div key={task.id} className="px-2 py-1.5 rounded bg-[var(--bg-secondary)]">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="truncate text-[var(--text-primary)]">{task.comic.title}</span>
                      </div>
                      <ProgressBar progress={task.progress} status={task.status} totalPages={task.totalPages} downloadedPages={task.downloadedPages} />
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          {/* 独立任务卡（不属于专辑或单章） */}
          {tasks.filter(t => !albumTaskIds.has(t.id)).filter(t => matchStatusFilter(t.status, statusFilter)).map((task) => (
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


