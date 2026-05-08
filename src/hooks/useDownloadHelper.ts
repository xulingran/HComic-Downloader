import { useDownload } from './useIpc'
import { useDownloadStore } from '../stores/useDownloadStore'
import type { ComicInfo, DownloadStatus } from '@shared/types'

export function useDownloadHelper() {
  const { startDownload, checkDownloadConflict } = useDownload()
  const upsertTask = useDownloadStore((s) => s.upsertTask)

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
      if (result.taskId) {
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

  return { downloadWithConflictCheck, startDownload, checkDownloadConflict }
}
