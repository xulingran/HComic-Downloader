import { useDownload } from './useIpc'
import type { ComicInfo } from '@shared/types'

export function useDownloadHelper() {
  const { startDownload, checkDownloadConflict } = useDownload()

  const downloadWithConflictCheck = async (comic: ComicInfo) => {
    try {
      const conflict = await checkDownloadConflict(comic)
      if (conflict.hasConflict) {
        const confirmed = window.confirm(
          `"${comic.title}" 已存在:\n${conflict.path}\n\n是否覆盖?`
        )
        if (!confirmed) return false
        await startDownload(comic.id, comic, true)
      } else {
        await startDownload(comic.id, comic)
      }
      return true
    } catch (err) {
      console.error('Download failed:', err)
      return false
    }
  }

  return { downloadWithConflictCheck, startDownload, checkDownloadConflict }
}
