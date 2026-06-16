import { useState, useCallback } from 'react'
import { ComicInfo } from '@shared/types'

export function getComicKey(comic: ComicInfo): string {
  return `${comic.sourceSite ?? 'hcomic'}_${comic.source ?? 'unknown'}_${comic.id}`
}

/**
 * 统一的"toggle 方向"判定：已选中 → 移除，未选中 → 添加。
 * 将方向语义收敛到单一实现，避免上层（useBatchDownload 的缓存同步）与底层
 * （useBatchSelect.toggleSelect）各自独立判断而产生"改一处忘改另一处"的脆弱性。
 */
export function toggleDirection(key: string, selectedIds: Set<string>): 'add' | 'remove' {
  return selectedIds.has(key) ? 'remove' : 'add'
}

export function useBatchSelect() {
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const toggleSelect = useCallback((comic: ComicInfo) => {
    const key = getComicKey(comic)
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (toggleDirection(key, prev) === 'remove') next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const selectAll = useCallback((comics: ComicInfo[]) => {
    setSelectedIds(new Set(comics.map(c => getComicKey(c))))
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const exitBatchMode = useCallback(() => {
    setBatchMode(false)
    setSelectedIds(new Set())
  }, [])

  return {
    batchMode,
    setBatchMode,
    selectedIds,
    toggleSelect,
    selectAll,
    clearSelection,
    exitBatchMode,
  }
}
