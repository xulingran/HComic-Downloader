import { useCallback, useRef } from 'react'
import { ComicInfo } from '@shared/types'
import { useDownloadHelper } from './useDownloadHelper'
import { useBatchSelect, getComicKey } from './useBatchSelect'

export { getComicKey }

export function useBatchDownload(comics: ComicInfo[]) {
  const comicsRef = useRef(comics)
  comicsRef.current = comics // eslint-disable-line react-hooks/refs
  const { downloadWithConflictCheck } = useDownloadHelper()
  const batch = useBatchSelect()

  const handleBatchDownload = useCallback(async () => {
    const comicsToDownload = Array.from(batch.selectedIds)
      .map(key => comicsRef.current.find(c => getComicKey(c) === key))
      .filter((c): c is ComicInfo => c !== undefined)
    await Promise.allSettled(comicsToDownload.map(comic => downloadWithConflictCheck(comic)))
    batch.exitBatchMode()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch.selectedIds, batch.exitBatchMode, downloadWithConflictCheck])

  return {
    ...batch,
    handleBatchDownload,
  }
}
