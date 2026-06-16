import { useDownloadCommands, useComicDetail, useAlbumCommands } from './useIpc'
import { useDownloadStore } from '../stores/useDownloadStore'
import { useToastStore } from '../stores/useToastStore'
import type { ComicInfo, DownloadStatus, QueuedBatchAlbumTask } from '@shared/types'

function comicBatchKey(comic: ComicInfo) {
  return `${comic.sourceSite ?? 'hcomic'}\0${comic.source ?? ''}\0${comic.id}`
}

function queuedBatchTaskKey(task: QueuedBatchAlbumTask) {
  return `${task.sourceSite || 'hcomic'}\0${task.source || ''}\0${task.comicId}`
}

export function useDownloadHelper() {
  const { startDownload, checkDownloadConflict, downloadBatchAsAlbum, pauseTask, resumeTask, retryTask, toggleGlobalPause } = useDownloadCommands()
  const { pauseAlbum, resumeAlbum, cancelAlbum } = useAlbumCommands()
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
      useToastStore.getState().error('下载失败，请重试')
      return false
    }
  }

  const downloadBatchAsAlbumWithToast = async (
    comics: ComicInfo[],
    albumTitle: string,
  ): Promise<{ success: boolean; failedCount: number }> => {
    try {
      const result = await downloadBatchAsAlbum(comics, albumTitle)
      const taskIds = 'taskIds' in result && Array.isArray(result.taskIds)
        ? result.taskIds
        : []
      // 严格按后端返回的 queuedTasks 中的 (sourceSite, source, comicId) 精确匹配回 comic。
      // 不使用 taskIds 下标 fallback：当用户中途反选再选时，前端 selectedComics 的顺序
      // 与后端入队顺序未必一致，下标对齐会错配 comic 到错误的 taskId。
      const comicsByKey = new Map(comics.map((comic) => [comicBatchKey(comic), comic]))
      const queuedTasks = Array.isArray(result.queuedTasks) ? result.queuedTasks : []
      // taskId → comic 映射（仅信任 queuedTasks 提供的显式关联）
      for (const task of queuedTasks) {
        const comic = comicsByKey.get(queuedBatchTaskKey(task))
        if (!comic) continue
        upsertTask({
          id: task.taskId,
          comic,
          status: 'queued',
          progress: 0,
          totalPages: comic.pages || 0,
          downloadedPages: 0,
        })
      }
      const failed = result.failedComics ?? []
      if (failed.length > 0) {
        const names = failed.map((f) => f.name).join('、')
        useToastStore.getState().show(
          taskIds.length > 0
            ? `部分漫画加入下载失败：${names}`
            : `漫画加入下载失败：${names}`,
          'error'
        )
      }
      if (taskIds.length > 0) {
        useToastStore.getState().success(`专辑 "${albumTitle}" 已加入下载队列 (${taskIds.length} 本)`)
      }
      // 返回 failedCount 供上层决定是否退出批量模式：部分失败时保留选中以便重试，
      // 重试时已成功的项会被后端 add_task 的去重 guard 跳过（不会重复下载）。
      return { success: taskIds.length > 0, failedCount: failed.length }
    } catch (err) {
      console.error('Batch album download failed:', err)
      useToastStore.getState().error('专辑下载失败，请重试')
      return { success: false, failedCount: 0 }
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
      useToastStore.getState().error('章节下载失败，请重试')
      return false
    }
  }

  const handlePauseTask = async (taskId: string) => {
    try {
      await pauseTask(taskId)
      updateTask(taskId, { status: 'pausing' as DownloadStatus })
    } catch (err) {
      console.error('Failed to pause task:', err)
      useToastStore.getState().error('暂停任务失败')
    }
  }

  const handleResumeTask = async (taskId: string) => {
    try {
      await resumeTask(taskId)
      updateTask(taskId, { status: 'queued' as DownloadStatus })
    } catch (err) {
      console.error('Failed to resume task:', err)
      useToastStore.getState().error('恢复任务失败')
    }
  }

  const handleRetryTask = async (taskId: string) => {
    try {
      await retryTask(taskId)
      updateTask(taskId, { status: 'queued' as DownloadStatus, progress: 0, error: undefined })
    } catch (err) {
      console.error('Failed to retry task:', err)
      useToastStore.getState().error('重试任务失败')
    }
  }

  const handleToggleGlobalPause = async () => {
    try {
      const result = await toggleGlobalPause()
      setGlobalPaused(result.isPaused)
    } catch (err) {
      console.error('Failed to toggle global pause:', err)
      useToastStore.getState().error('切换全局暂停失败')
    }
  }

  // ── 专辑级批量控制 ──
  // 调用后端专辑方法，然后乐观更新 store 中该专辑所有任务的状态。
  // taskIds 用于本地状态预判（如取消时跳过 completed）。
  const handlePauseAlbum = async (sourceSite: string, albumId: string, taskIds: string[]) => {
    try {
      await pauseAlbum(sourceSite, albumId)
      for (const tid of taskIds) {
        const task = useDownloadStore.getState().tasks.find((t) => t.id === tid)
        if (!task) continue
        // downloading → pausing；queued → paused
        const next: DownloadStatus = task.status === 'downloading' || task.status === 'pausing' ? 'pausing' : 'paused'
        updateTask(tid, { status: next })
      }
    } catch (err) {
      console.error('Failed to pause album:', err)
      useToastStore.getState().error('暂停专辑失败')
    }
  }

  const handleResumeAlbum = async (sourceSite: string, albumId: string, taskIds: string[]) => {
    try {
      await resumeAlbum(sourceSite, albumId)
      for (const tid of taskIds) {
        const task = useDownloadStore.getState().tasks.find((t) => t.id === tid)
        if (!task) continue
        if (task.status === 'paused' || task.status === 'pausing') {
          updateTask(tid, { status: 'queued' })
        }
      }
    } catch (err) {
      console.error('Failed to resume album:', err)
      useToastStore.getState().error('恢复专辑失败')
    }
  }

  const handleCancelAlbum = async (sourceSite: string, albumId: string, taskIds: string[]) => {
    try {
      await cancelAlbum(sourceSite, albumId)
      for (const tid of taskIds) {
        const task = useDownloadStore.getState().tasks.find((t) => t.id === tid)
        if (!task) continue
        // 跳过已完成的章节（保留已下载文件）
        if (task.status !== 'completed' && task.status !== 'cancelled') {
          updateTask(tid, { status: 'cancelled' })
        }
      }
    } catch (err) {
      console.error('Failed to cancel album:', err)
      useToastStore.getState().error('取消专辑失败')
    }
  }

  return { downloadWithConflictCheck, downloadBatchAsAlbum: downloadBatchAsAlbumWithToast, downloadChapters, startDownload, checkDownloadConflict, handlePauseTask, handleResumeTask, handleRetryTask, handleToggleGlobalPause, handlePauseAlbum, handleResumeAlbum, handleCancelAlbum }
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
