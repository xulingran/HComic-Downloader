import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import { useDownloadStore } from '../../stores/useDownloadStore'
import { useToastStore } from '../../stores/useToastStore'
import { useDownload, useAlbumProgress, useAlbumCommands, useConfig } from '../../hooks/useIpc'
import { useDownloadHelper } from '../../hooks/useDownloadHelper'
import { ProgressBar } from '../common/ProgressBar'
import { TaskActionButtons } from '../common/TaskActionButtons'
import { taskItemVariants, getReducedTaskItemVariants, useReducedMotionPreference } from '../../lib/anim'
import type { DownloadStatus, DownloadDetail } from '@shared/types'
import { ACTIVE_DOWNLOAD_STATUSES, RUNNING_DOWNLOAD_STATUSES } from '@shared/types'

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
  if (filter === 'active') return RUNNING_DOWNLOAD_STATUSES.has(status)
  return status === filter
}

/**
 * 下载任务子视图——原 DownloadPage 的任务列表逻辑完整保留。
 *
 * 从 DownloadPage 工作区容器接收 `isActive` 以执行 keep-alive 刷新。
 * 所有暂停/恢复/重试/取消/专辑折叠/强制打包行为保持不变。
 */
export function DownloadTasksView({ isActive = false }: { isActive?: boolean }) {
  const { tasks, setTasks, updateTask, isGloballyPaused } = useDownloadStore()
  const { getDownloads, cancelDownload, progress } = useDownload()
  const {
    handlePauseTask,
    handleResumeTask,
    handleRetryTask,
    handleToggleGlobalPause,
    handlePauseAlbum,
    handleResumeAlbum,
    handleCancelAlbum,
  } = useDownloadHelper()
  const { getConfig, openDownloadDir } = useConfig()
  const [failedDialog, setFailedDialog] = useState<DownloadDetail | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const { forcePackAlbum } = useAlbumCommands()
  const { albumProgress } = useAlbumProgress()
  const [downloadDir, setDownloadDir] = useState('')
  const reduceMotion = useReducedMotionPreference()
  const taskVariants = reduceMotion ? getReducedTaskItemVariants() : taskItemVariants

  const [expandedAlbums, setExpandedAlbums] = useState<Set<string>>(() => new Set())
  const albumInitializedRef = useRef<Set<string>>(new Set())

  const albumGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        albumId: string
        sourceSite: string
        albumTitle: string
        tasks: typeof tasks
        totalChapters: number
      }
    >()
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

  const albumTaskIds = useMemo(() => {
    const ids = new Set<string>()
    for (const g of albumGroups.values()) {
      for (const t of g.tasks) ids.add(t.id)
    }
    return ids
  }, [albumGroups])

  const albumFailedMap = useMemo(() => {
    const m = new Map<string, boolean>()
    for (const [key, g] of albumGroups.entries()) {
      m.set(key, g.tasks.some((t) => t.status === 'failed'))
    }
    return m
  }, [albumGroups])

  useEffect(() => {
    const toInit = [...albumFailedMap.entries()].filter(([key]) => !albumInitializedRef.current.has(key))
    toInit.forEach(([key]) => albumInitializedRef.current.add(key))
    const failedInit = toInit.filter(([, hasFailed]) => hasFailed).map(([key]) => key)
    if (failedInit.length === 0) return
    setExpandedAlbums((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const key of failedInit) {
        if (!next.has(key)) {
          next.add(key)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [albumFailedMap])

  const albumPrevFailedRef = useRef<Map<string, boolean>>(new Map())
  useEffect(() => {
    const prevMap = albumPrevFailedRef.current
    const newlyFailed: string[] = []
    for (const [key, hasFailed] of albumFailedMap.entries()) {
      const wasFailed = prevMap.get(key) ?? false
      if (hasFailed && !wasFailed) newlyFailed.push(key)
      prevMap.set(key, hasFailed)
    }
    if (newlyFailed.length === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpandedAlbums((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const key of newlyFailed) {
        if (!next.has(key)) {
          next.add(key)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [albumFailedMap])

  const toggleAlbum = useCallback((key: string) => {
    setExpandedAlbums((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const loadDownloads = useCallback(async () => {
    try {
      const result = await getDownloads()
      setTasks(result.tasks)
    } catch (err) {
      console.error('Failed to load downloads:', err)
      useToastStore.getState().error('加载下载列表失败')
    }
  }, [getDownloads, setTasks])

  useEffect(() => {
    loadDownloads()
    getConfig()
      .then((result) => setDownloadDir(result.config?.downloadDir ?? ''))
      .catch((err) => {
        console.error('Failed to load config:', err)
      })
  }, [loadDownloads, getConfig])

  useEffect(() => {
    const currentTasks = useDownloadStore.getState().tasks
    for (const [taskId, data] of Object.entries(progress)) {
      const existingTask = currentTasks.find((t) => t.id === taskId)
      if (!existingTask) continue
      updateTask(taskId, {
        status: data.status as DownloadStatus,
        progress: data.progress,
        totalPages: data.total,
        downloadedPages: data.current,
      })
      if (data.status === 'failed' && existingTask.status !== 'failed') {
        window.hcomic?.getDownloadDetail(taskId).then((detail) => setFailedDialog(detail)).catch(() => {})
      }
    }
  }, [progress, updateTask])

  const isFirstActiveRef = useRef(true)
  useEffect(() => {
    if (!isActive) {
      isFirstActiveRef.current = true
      return
    }
    if (isFirstActiveRef.current) {
      isFirstActiveRef.current = false
      return
    }
    loadDownloads()
  }, [isActive, loadDownloads])

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
    <div data-testid="download-tasks-view">
      <header className="space-y-3" data-testid="download-page-header">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2" data-testid="download-page-actions">
            {tasks.length > 0 && (
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="px-2 py-1 text-sm rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)]"
              >
                {STATUS_FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={handleToggleGlobalPause}
              className={`px-3 py-1 text-sm rounded-lg transition-colors
                ${isGloballyPaused ? 'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]' : 'bg-[var(--bg-primary)] border border-[var(--border)] hover:bg-[var(--bg-secondary)]'}`}
            >
              {isGloballyPaused ? '▶ 恢复' : '⏸ 暂停'}
            </button>
            <button
              onClick={handleRefresh}
              className="px-3 py-1 text-sm bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg hover:bg-[var(--bg-secondary)] transition-colors"
            >
              刷新
            </button>
          </div>
        </div>
        {downloadDir && (
          <div
            className="flex min-w-0 items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] px-4 py-3 text-xs text-[var(--text-secondary)] shadow-sm"
            data-testid="download-directory-row"
          >
            <span className="text-[var(--text-secondary)] flex-shrink-0">📂 下载目录:</span>
            <span className="min-w-0 flex-1 truncate" title={downloadDir}>
              {downloadDir}
            </span>
            <button
              onClick={handleOpenDir}
              className="flex-shrink-0 whitespace-nowrap rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-tertiary)]"
            >
              打开
            </button>
          </div>
        )}
      </header>

      {tasks.length === 0 ? (
        <div
          className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] px-6 py-16 text-center text-[var(--text-secondary)] shadow-sm"
          data-testid="download-empty-state"
        >
          暂无下载任务
        </div>
      ) : (
        <LayoutGroup>
          <AnimatePresence mode="popLayout">
            <div className="space-y-4" data-testid="download-task-list">
              {statusFilter !== 'all' && (
                <div className="text-xs text-[var(--text-secondary)]">
                  显示{' '}
                  {(() => {
                    const filteredStandalone = tasks.filter((t) => !albumTaskIds.has(t.id) && matchStatusFilter(t.status, statusFilter)).length
                    const filteredAlbums = [...albumGroups.values()].filter((g) => g.tasks.some((t) => matchStatusFilter(t.status, statusFilter))).length
                    const total = filteredAlbums + filteredStandalone
                    return `${total} / ${tasks.length} 个任务`
                  })()}
                </div>
              )}

              {[...albumGroups.entries()].map(([key, group]) => {
                const completed = group.tasks.filter((t) => t.status === 'completed').length
                const hasFailures = group.tasks.some((t) => t.status === 'failed')
                const ap = albumProgress[key]
                const isPacked = ap?.event === 'packed'
                const taskIds = group.tasks.map((t) => t.id)

                const hasActive = group.tasks.some((t) => ACTIVE_DOWNLOAD_STATUSES.has(t.status))
                const allPaused = group.tasks.length > 0 && group.tasks.every((t) => t.status === 'paused' || t.status === 'pausing')
                const hasAnyFailed = group.tasks.some((t) => t.status === 'failed')
                const isExpanded = expandedAlbums.has(key)
                const sortedTasks = [...group.tasks.filter((t) => t.status === 'failed'), ...group.tasks.filter((t) => t.status !== 'failed')]

                return (
                  <motion.div
                    key={key}
                    layout={!reduceMotion}
                    variants={taskVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    className="rounded-xl border border-[var(--border)] border-l-4 border-l-[var(--accent)] bg-[var(--bg-primary)] p-5 shadow-sm"
                  >
                    <div
                      className="flex items-center justify-between mb-2 cursor-pointer select-none"
                      onClick={() => toggleAlbum(key)}
                      title={isExpanded ? '点击折叠章节' : '点击展开章节'}
                    >
                      <h3 className="text-sm font-medium text-[var(--text-primary)] truncate">{group.albumTitle}</h3>
                      <div className="flex gap-1.5 flex-shrink-0 ml-2">
                        {!isPacked && (
                          <>
                            {hasActive && !allPaused && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handlePauseAlbum(group.sourceSite, group.albumId, taskIds)
                                }}
                                className="text-xs px-2 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                              >
                                全部暂停
                              </button>
                            )}
                            {allPaused && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleResumeAlbum(group.sourceSite, group.albumId, taskIds)
                                }}
                                className="text-xs px-2 py-0.5 rounded bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
                              >
                                全部恢复
                              </button>
                            )}
                            {hasAnyFailed && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  for (const t of group.tasks) {
                                    if (t.status === 'failed') handleRetryTask(t.id)
                                  }
                                }}
                                className="text-xs px-2 py-0.5 rounded bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
                              >
                                重试失败
                              </button>
                            )}
                            {hasActive && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (window.confirm(`取消专辑 "${group.albumTitle}" 的所有未完成任务？\n已下载的章节会保留在磁盘上。`)) {
                                    handleCancelAlbum(group.sourceSite, group.albumId, taskIds)
                                  }
                                }}
                                className="text-xs px-2 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--error)] hover:bg-[var(--bg-tertiary)]"
                              >
                                全部取消
                              </button>
                            )}
                            {completed > 0 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  forcePackAlbum(group.sourceSite, group.albumId)
                                }}
                                className="text-xs px-2 py-0.5 rounded bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
                              >
                                强制打包
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-[var(--text-secondary)] mb-2">
                      {isPacked ? '已打包' : `${completed}/${group.totalChapters} 章完成`}
                      {hasFailures && ' (有失败)'}
                    </div>
                    <ProgressBar progress={Math.round((completed / group.totalChapters) * 100)} status={isPacked ? 'completed' : 'downloading'} totalPages={group.totalChapters} downloadedPages={completed} />
                    {isExpanded ? (
                      <>
                        <button onClick={() => toggleAlbum(key)} className="mt-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                          ▼ 隐藏章节
                        </button>
                        <div className="mt-2 space-y-2">
                          {sortedTasks.map((task) => (
                            <div key={task.id} className="rounded-lg bg-[var(--bg-secondary)] px-3 py-2.5">
                              <div className="flex items-center justify-between text-xs mb-1 gap-2">
                                <span className="truncate text-[var(--text-primary)] flex-1 min-w-0">{task.comic.title}</span>
                                <TaskActionButtons task={task} onPause={handlePauseTask} onResume={handleResumeTask} onCancel={handleCancel} onRetry={handleRetryTask} />
                              </div>
                              <ProgressBar progress={task.progress} status={task.status} totalPages={task.totalPages} downloadedPages={task.downloadedPages} />
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <button onClick={() => toggleAlbum(key)} className="mt-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                        ▶ 展开查看 {group.tasks.length} 章
                      </button>
                    )}
                  </motion.div>
                )
              })}

              {tasks
                .filter((t) => !albumTaskIds.has(t.id))
                .filter((t) => matchStatusFilter(t.status, statusFilter))
                .map((task) => (
                  <motion.div
                    key={task.id}
                    layout={!reduceMotion}
                    variants={taskVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-5 shadow-sm"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium text-[var(--text-primary)] flex-1 min-w-0 truncate">{task.comic.title}</h3>
                      <div className="flex gap-1.5 flex-shrink-0 ml-2">
                        {(task.status === 'downloading' || task.status === 'queued') && (
                          <>
                            <button onClick={() => handlePauseTask(task.id)} className="text-xs px-2 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]">
                              暂停
                            </button>
                            <button onClick={() => handleCancel(task.id)} className="text-xs px-2 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--error)] hover:bg-[var(--bg-tertiary)]">
                              取消
                            </button>
                          </>
                        )}
                        {task.status === 'pausing' && (
                          <>
                            <span className="text-xs px-2 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)]">暂停中</span>
                            <button onClick={() => handleCancel(task.id)} className="text-xs px-2 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--error)] hover:bg-[var(--bg-tertiary)]">
                              取消
                            </button>
                          </>
                        )}
                        {task.status === 'paused' && (
                          <>
                            <button onClick={() => handleResumeTask(task.id)} className="text-xs px-2 py-0.5 rounded bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]">
                              恢复
                            </button>
                            <button onClick={() => handleCancel(task.id)} className="text-xs px-2 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--error)] hover:bg-[var(--bg-tertiary)]">
                              取消
                            </button>
                          </>
                        )}
                        {task.status === 'failed' && (
                          <button onClick={() => handleRetryTask(task.id)} className="text-xs px-2 py-0.5 rounded bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]">
                            重试
                          </button>
                        )}
                      </div>
                    </div>
                    <ProgressBar progress={task.progress} status={task.status} totalPages={task.totalPages} downloadedPages={task.downloadedPages} />
                    {task.error && <p className="text-xs text-[var(--error)] mt-2">{task.error}</p>}
                  </motion.div>
                ))}
            </div>
          </AnimatePresence>
        </LayoutGroup>
      )}

      {failedDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setFailedDialog(null)}>
          <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-lg max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-medium text-[var(--error)] mb-2">下载失败</h3>
            <p className="text-sm text-[var(--text-secondary)] mb-4">{failedDialog.errorMessage || '未知错误'}</p>
            {failedDialog.tempDir && <p className="text-xs text-[var(--text-secondary)] mb-4">临时文件目录: {failedDialog.tempDir}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setFailedDialog(null)} className="px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)]">
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
