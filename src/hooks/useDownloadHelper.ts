import { useDownloadCommands, useComicDetail } from './useIpc'
import { useDownloadStore } from '../stores/useDownloadStore'
import type { ComicInfo, DownloadStatus } from '@shared/types'

export function useDownloadHelper() {
  const { startDownload, checkDownloadConflict, pauseTask, resumeTask, retryTask, toggleGlobalPause } = useDownloadCommands()
  const upsertTask = useDownloadStore((s) => s.upsertTask)
  const updateTask = useDownloadStore((s) => s.updateTask)
  const setGlobalPaused = useDownloadStore((s) => s.setGlobalPaused)

  const downloadWithConflictCheck = async (comic: ComicInfo) => {
    try {
      const conflict = await checkDownloadConflict(comic)
      if (conflict.hasConflict) {
        const confirmed = window.confirm(
          `"${comic.title}" 已存在:\n${conflict.path}\n\n是否覆盖?`
        )
        if (!confirmed) return false
      }
      const result = await startDownload(
        comic.id,
        comic,
        conflict.hasConflict ? true : undefined
      )
      if ('taskId' in result && result.taskId) {
        upsertTask({
          id: result.taskId,
          comic,
          status: (result.status as DownloadStatus) || 'queued',
          progress: 0,
          totalPages: comic.pages || 0,
          downloadedPages: 0,
        })
      } else if (result.status === 'conflict') {
        window.confirm(
          `"${comic.title}" 在检查后被其他任务创建，请重试。`
        )
        return false
      }
      return true
    } catch (err) {
      console.error('Download failed:', err)
      return false
    }
  }

  const downloadChapters = async (comic: ComicInfo, chapterIds: string[]) => {
    try {
      const result = await startDownload(comic.id, comic, undefined, chapterIds)
      const taskIds = 'taskIds' in result && Array.isArray(result.taskIds)
        ? result.taskIds
        : ('taskId' in result && result.taskId ? [result.taskId] : [])
      for (const taskId of taskIds) {
        upsertTask({
          id: taskId,
          comic,
          status: 'queued',
          progress: 0,
          totalPages: comic.pages || 0,
          downloadedPages: 0,
        })
      }
      // 后端逐章建任务，部分章节可能失败：提示用户哪些章节未能加入下载。
      const failed = 'failedChapters' in result ? (result.failedChapters ?? []) : []
      if (failed.length > 0) {
        const names = failed.map((f) => f.name).join('、')
        window.alert(
          taskIds.length > 0
            ? `部分章节加入下载失败：${names}`
            : `章节加入下载失败：${names}`
        )
      }
      return taskIds.length > 0
    } catch (err) {
      console.error('Chapter download failed:', err)
      return false
    }
  }

  const handlePauseTask = async (taskId: string) => {
    try {
      await pauseTask(taskId)
      updateTask(taskId, { status: 'pausing' as DownloadStatus })
    } catch (err) {
      console.error('Failed to pause task:', err)
    }
  }

  const handleResumeTask = async (taskId: string) => {
    try {
      await resumeTask(taskId)
      updateTask(taskId, { status: 'queued' as DownloadStatus })
    } catch (err) {
      console.error('Failed to resume task:', err)
    }
  }

  const handleRetryTask = async (taskId: string) => {
    try {
      await retryTask(taskId)
      updateTask(taskId, { status: 'queued' as DownloadStatus, progress: 0, error: undefined })
    } catch (err) {
      console.error('Failed to retry task:', err)
    }
  }

  const handleToggleGlobalPause = async () => {
    try {
      const result = await toggleGlobalPause()
      setGlobalPaused(result.isPaused)
    } catch (err) {
      console.error('Failed to toggle global pause:', err)
    }
  }

  return { downloadWithConflictCheck, downloadChapters, startDownload, checkDownloadConflict, handlePauseTask, handleResumeTask, handleRetryTask, handleToggleGlobalPause }
}

/**
 * 下载前探测漫画是否有多个章节。
 * - 返回带 chapters 的 ComicInfo → 调用方应弹出章节选择对话框
 * - 返回 null → 无需选择章节，直接下载
 */
export function useChapterProbe() {
  const { getComicDetail } = useComicDetail()

  const probeChaptersBeforeDownload = async (comic: ComicInfo): Promise<ComicInfo | null> => {
    // 已知多章节，直接返回
    if (comic.chapters && comic.chapters.length > 1) {
      return comic
    }
    // bika 始终有章节列表；其他来源仅当 albumTotalChapters > 1 时探测
    const needsProbe =
      (!comic.chapters || comic.chapters.length === 0) &&
      (comic.sourceSite === 'bika' || (comic.albumTotalChapters ?? 1) > 1)
    if (needsProbe) {
      try {
        const result = await getComicDetail(comic.id, comic.sourceSite, comic.url || '')
        if (result.comic?.chapters && result.comic.chapters.length > 1) {
          return { ...comic, chapters: result.comic.chapters }
        }
      } catch (err) {
        console.error('Failed to fetch chapters before download:', err)
      }
    }
    return null
  }

  return { probeChaptersBeforeDownload }
}
