import { ComicInfo } from '@shared/types'
import { useDownloadHelper } from './useDownloadHelper'
import { useBatchSelect, getComicKey } from './useBatchSelect'

export { getComicKey }

export function useBatchDownload(comics: ComicInfo[]) {
  const { downloadWithConflictCheck } = useDownloadHelper()
  const batch = useBatchSelect()

  const handleBatchDownload = async () => {
    const comicsToDownload = Array.from(batch.selectedIds)
      .map(key => comics.find(c => getComicKey(c) === key))
      .filter((c): c is ComicInfo => c !== undefined)
    await Promise.allSettled(comicsToDownload.map(comic => downloadWithConflictCheck(comic)))
    batch.exitBatchMode()
  }

  return {
    ...batch,
    handleBatchDownload,
  }
}
