import { useCallback, useRef } from 'react'
import { ComicInfo } from '@shared/types'
import { useDownloadHelper } from './useDownloadHelper'
import { useBatchSelect, getComicKey } from './useBatchSelect'

export { getComicKey }

export function useBatchDownload(comics: ComicInfo[]) {
  const comicsRef = useRef(comics)
  comicsRef.current = comics // eslint-disable-line react-hooks/refs
  const { downloadWithConflictCheck, downloadBatchAsAlbum } = useDownloadHelper()
  const batch = useBatchSelect()

  // 跨页选择缓存：在选中/取消选中时同步存储漫画完整数据，翻页后仍可定位
  const selectedCacheRef = useRef<Map<string, ComicInfo>>(new Map())

  // 包装 toggleSelect：选中时缓存漫画数据，取消时删除。
  // 约定：本层用 batch.selectedIds.has(key) 判断增删方向，与底层 useBatchSelect.toggleSelect
  // 内部"基于 getComicKey 判断 toggle 方向"的语义一致（同一 key）。两者都基于 getComicKey，
  // 当前实现保证方向同步；若 useBatchSelect 改为基于对象引用判断，需同步审视此处。
  const toggleSelect = useCallback((comic: ComicInfo) => {
    const key = getComicKey(comic)
    if (batch.selectedIds.has(key)) {
      selectedCacheRef.current.delete(key)
    } else {
      selectedCacheRef.current.set(key, comic)
    }
    batch.toggleSelect(comic)
  }, [batch])

  // 包装 selectAll：缓存所有当前页漫画
  const selectAll = useCallback((comicsList: ComicInfo[]) => {
    for (const comic of comicsList) {
      selectedCacheRef.current.set(getComicKey(comic), comic)
    }
    batch.selectAll(comicsList)
  }, [batch])

  // 包装 clearSelection：清空缓存
  const clearSelection = useCallback(() => {
    selectedCacheRef.current.clear()
    batch.clearSelection()
  }, [batch])

  // 包装 exitBatchMode：清空缓存
  const exitBatchMode = useCallback(() => {
    selectedCacheRef.current.clear()
    batch.exitBatchMode()
  }, [batch])

  const selectedComics = useCallback(() => {
    return Array.from(batch.selectedIds)
      .map(key => selectedCacheRef.current.get(key))
      .filter((c): c is ComicInfo => c !== undefined)
  }, [batch.selectedIds])

  const handleBatchDownload = useCallback(async () => {
    const comicsToDownload = selectedComics()
    await Promise.allSettled(comicsToDownload.map(comic => downloadWithConflictCheck(comic)))
    exitBatchMode()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch.selectedIds, exitBatchMode, downloadWithConflictCheck, selectedComics])

  const handleBatchDownloadAsAlbum = useCallback(async (albumTitle: string) => {
    const comicsToDownload = selectedComics()
    if (comicsToDownload.length === 0) return false
    const success = await downloadBatchAsAlbum(comicsToDownload, albumTitle)
    if (success) {
      exitBatchMode()
    }
    return success
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch.selectedIds, exitBatchMode, downloadBatchAsAlbum, selectedComics])

  return {
    ...batch,
    toggleSelect,
    selectAll,
    clearSelection,
    exitBatchMode,
    handleBatchDownload,
    handleBatchDownloadAsAlbum,
  }
}
