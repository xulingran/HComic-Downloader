import { useCallback, useRef } from 'react'
import { ComicInfo } from '@shared/types'
import { useDownloadHelper } from './useDownloadHelper'
import { useBatchSelect, getComicKey, toggleDirection } from './useBatchSelect'

export { getComicKey }

export function useBatchDownload(comics: ComicInfo[]) {
  const comicsRef = useRef(comics)
  comicsRef.current = comics // eslint-disable-line react-hooks/refs
  const { downloadWithConflictCheck, downloadBatchAsAlbum } = useDownloadHelper()
  const batch = useBatchSelect()

  // 跨页选择缓存：在选中/取消选中时同步存储漫画完整数据，翻页后仍可定位
  const selectedCacheRef = useRef<Map<string, ComicInfo>>(new Map())

  // 包装 toggleSelect：选中时缓存漫画数据，取消时删除。
  // 方向判定复用共享的 toggleDirection（与底层 useBatchSelect.toggleSelect 同一实现），
  // 避免"两处独立判断方向"导致的改一处忘改另一处的脆弱性。
  const toggleSelect = useCallback((comic: ComicInfo) => {
    const key = getComicKey(comic)
    if (toggleDirection(key, batch.selectedIds) === 'remove') {
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
    const { success, failedCount } = await downloadBatchAsAlbum(comicsToDownload, albumTitle)
    // 仅当全部成功（无失败）时才退出批量模式并清空选中。
    // 部分失败时保留批量模式与选中项，用户可直接再次"下载为专辑"重试失败项；
    // 已成功入队的项会被后端 add_task 的去重 guard 跳过，不会重复下载。
    if (success && failedCount === 0) {
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
    selectedComics,
    handleBatchDownload,
    handleBatchDownloadAsAlbum,
  }
}
