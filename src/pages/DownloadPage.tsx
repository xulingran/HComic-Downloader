import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import { useDownloadStore } from '../stores/useDownloadStore'
import { useToastStore } from '../stores/useToastStore'
import { useDownload, useAlbumProgress, useAlbumCommands, useConfig } from '../hooks/useIpc'
import { useDownloadHelper } from '../hooks/useDownloadHelper'
import { ProgressBar } from '../components/common/ProgressBar'
import { TaskActionButtons } from '../components/common/TaskActionButtons'
import { taskItemVariants, getReducedTaskItemVariants, useReducedMotionPreference } from '../lib/anim'
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
  // 'active' 过滤器：运行中（queued/downloading/pausing），不含已暂停的 paused。
  // 用 RUNNING_DOWNLOAD_STATUSES 派生（语义≠ACTIVE_DOWNLOAD_STATUSES：后者含 paused）。
  if (filter === 'active') return RUNNING_DOWNLOAD_STATUSES.has(status)
  return status === filter
}

interface DownloadPageProps {
  /** 该页是否为当前激活 tab。keep-alive 下用于切回时轻量刷新任务列表。 */
  isActive?: boolean
}

export function DownloadPage({ isActive = false }: DownloadPageProps = {}) {
  const { tasks, setTasks, updateTask, isGloballyPaused } = useDownloadStore()
  const { getDownloads, cancelDownload, progress } = useDownload()
  const { handlePauseTask, handleResumeTask, handleRetryTask, handleToggleGlobalPause, handlePauseAlbum, handleResumeAlbum, handleCancelAlbum } = useDownloadHelper()
  const { getConfig, openDownloadDir } = useConfig()
  const [failedDialog, setFailedDialog] = useState<DownloadDetail | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const { forcePackAlbum } = useAlbumCommands()
  const { albumProgress } = useAlbumProgress()
  const [downloadDir, setDownloadDir] = useState('')
  // 变更 4：任务列表进出场动画。
  const reduceMotion = useReducedMotionPreference()
  const taskVariants = reduceMotion ? getReducedTaskItemVariants() : taskItemVariants

  // 专辑折叠状态：键为 `${sourceSite}_${albumId}`（与 albumGroups key 一致）。
  // 集合内存放"已展开"的 key；不在集合中即视为折叠。
  // 纯前端、会话内有效，不持久化（见 spec: download-album-collapse）。
  const [expandedAlbums, setExpandedAlbums] = useState<Set<string>>(() => new Set())
  // 记录哪些 key 已被初始化过默认值，避免重复初始化覆盖用户操作
  const albumInitializedRef = useRef<Set<string>>(new Set())

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

  // 每个专辑是否有失败章节（key → bool），供初始化 / 失败上升监听共用
  const albumFailedMap = useMemo(() => {
    const m = new Map<string, boolean>()
    for (const [key, g] of albumGroups.entries()) {
      m.set(key, g.tasks.some((t) => t.status === 'failed'))
    }
    return m
  }, [albumGroups])

  // 1.2 初始化：首次出现某 key 时，若有失败章节则展开；否则保持折叠。
  // 仅在 key 首次进入集合时写入，避免覆盖用户后续操作。
  // 注意：ref 更新必须在 effect 体内完成，setExpandedAlbums 的 updater 只返回纯状态，
  // 不在其中执行副作用——updater 在 StrictMode 下会被双调用、并发模式下可能重放，
  // 副作用若写在其中会因重放而错乱。
  useEffect(() => {
    // 第一阶段：在 effect 体内（非 updater 内）识别并标记"本次需初始化"的 key
    const toInit = [...albumFailedMap.entries()].filter(
      ([key]) => !albumInitializedRef.current.has(key)
    )
    toInit.forEach(([key]) => albumInitializedRef.current.add(key))
    // 第二阶段：仅对有失败的 key 提交一次纯状态更新
    const failedInit = toInit.filter(([, hasFailed]) => hasFailed).map(([key]) => key)
    if (failedInit.length === 0) return
    // 纯状态更新：set-state-in-effect 在此为必要模式（把派生的失败状态同步到本地
    // 折叠 UI），updater 保持纯净且有 changed 短路避免无谓重渲染。
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

  // 1.3 失败上升监听：hasAnyFailed 从 false→true 时展开；恢复时不自动移除。
  // 同样把 ref 更新留在 effect 体内，updater 保持纯净。
  const albumPrevFailedRef = useRef<Map<string, boolean>>(new Map())
  useEffect(() => {
    const prevMap = albumPrevFailedRef.current
    // 第一阶段：在 effect 体内识别"本次新上升为 failed"的 key，并同步 prevMap
    const newlyFailed: string[] = []
    for (const [key, hasFailed] of albumFailedMap.entries()) {
      const wasFailed = prevMap.get(key) ?? false
      if (hasFailed && !wasFailed) newlyFailed.push(key)
      prevMap.set(key, hasFailed)
    }
    if (newlyFailed.length === 0) return
    // 第二阶段：纯状态更新（同上，set-state-in-effect 为必要的派生状态同步）
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

  // 1.4 切换折叠
  const toggleAlbum = useCallback((key: string) => {
    setExpandedAlbums((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

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

  // keep-alive 切回刷新：isActive 从 false→true（切回下载页）时轻量重拉任务列表，
  // 同步后台下载状态变化。首挂载时 mount effect 已加载过，用 ref 跳过首次避免重复请求。
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive])

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
        <LayoutGroup>
        <AnimatePresence mode="popLayout">
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
            const taskIds = group.tasks.map(t => t.id)

            // 专辑聚合状态：用于决定头部显示哪些控制按钮（4 个活跃状态）
            const hasActive = group.tasks.some(t => ACTIVE_DOWNLOAD_STATUSES.has(t.status))
            const allPaused = group.tasks.length > 0 && group.tasks.every(t => t.status === 'paused' || t.status === 'pausing')
            const hasAnyFailed = group.tasks.some(t => t.status === 'failed')
            const isExpanded = expandedAlbums.has(key)
            // 失败优先、其余稳定排序（见 spec: download-album-collapse）
            const sortedTasks = [
              ...group.tasks.filter(t => t.status === 'failed'),
              ...group.tasks.filter(t => t.status !== 'failed'),
            ]

            return (
              <motion.div key={key} layout={!reduceMotion} variants={taskVariants} initial="initial" animate="animate" exit="exit" className="bg-[var(--bg-primary)] rounded-xl p-4 shadow-sm border-l-4 border-[var(--accent)]">
                <div
                  className="flex items-center justify-between mb-2 cursor-pointer select-none"
                  onClick={() => toggleAlbum(key)}
                  title={isExpanded ? '点击折叠章节' : '点击展开章节'}
                >
                  <h3 className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {group.albumTitle}
                  </h3>
                  <div className="flex gap-1.5 flex-shrink-0 ml-2">
                    {!isPacked && (
                      <>
                        {/* 暂停 / 恢复 整个专辑 */}
                        {hasActive && !allPaused && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handlePauseAlbum(group.sourceSite, group.albumId, taskIds) }}
                            className="text-xs px-2 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)]
                                       text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                          >
                            全部暂停
                          </button>
                        )}
                        {allPaused && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleResumeAlbum(group.sourceSite, group.albumId, taskIds) }}
                            className="text-xs px-2 py-0.5 rounded bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
                          >
                            全部恢复
                          </button>
                        )}
                        {/* 重试专辑（仅有失败章节时） */}
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
                        {/* 取消整个专辑（保留已下载文件） */}
                        {hasActive && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (window.confirm(`取消专辑 "${group.albumTitle}" 的所有未完成任务？\n已下载的章节会保留在磁盘上。`)) {
                                handleCancelAlbum(group.sourceSite, group.albumId, taskIds)
                              }
                            }}
                            className="text-xs px-2 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)]
                                       text-[var(--error)] hover:bg-[var(--bg-tertiary)]"
                          >
                            全部取消
                          </button>
                        )}
                        {/* 强制打包 */}
                        {completed > 0 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); forcePackAlbum(group.sourceSite, group.albumId) }}
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
                <ProgressBar
                  progress={Math.round((completed / group.totalChapters) * 100)}
                  status={isPacked ? 'completed' : 'downloading'}
                  totalPages={group.totalChapters}
                  downloadedPages={completed}
                />
                {/* 章节列表：默认折叠，仅展开时渲染（见 spec: download-album-collapse） */}
                {isExpanded ? (
                  <>
                    <button
                      onClick={() => toggleAlbum(key)}
                      className="mt-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      ▼ 隐藏章节
                    </button>
                    <div className="mt-1 space-y-1">
                      {sortedTasks.map(task => (
                        <div key={task.id} className="px-2 py-1.5 rounded bg-[var(--bg-secondary)]">
                          <div className="flex items-center justify-between text-xs mb-1 gap-2">
                            <span className="truncate text-[var(--text-primary)] flex-1 min-w-0">{task.comic.title}</span>
                            <TaskActionButtons
                              task={task}
                              onPause={handlePauseTask}
                              onResume={handleResumeTask}
                              onCancel={handleCancel}
                              onRetry={handleRetryTask}
                            />
                          </div>
                          <ProgressBar progress={task.progress} status={task.status} totalPages={task.totalPages} downloadedPages={task.downloadedPages} />
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <button
                    onClick={() => toggleAlbum(key)}
                    className="mt-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    ▶ 展开查看 {group.tasks.length} 章
                  </button>
                )}
              </motion.div>
            )
          })}

          {/* 独立任务卡（不属于专辑或单章） */}
          {tasks.filter(t => !albumTaskIds.has(t.id)).filter(t => matchStatusFilter(t.status, statusFilter)).map((task) => (
            <motion.div
              key={task.id}
              layout={!reduceMotion}
              variants={taskVariants}
              initial="initial"
              animate="animate"
              exit="exit"
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
            </motion.div>
          ))}
        </div>
        </AnimatePresence>
        </LayoutGroup>
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


