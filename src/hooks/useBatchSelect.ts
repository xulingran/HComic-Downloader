import { useState, useCallback } from 'react'
import { ComicInfo } from '@shared/types'

export function useBatchSelect() {
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const toggleSelect = useCallback((comic: ComicInfo) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(comic.id)) next.delete(comic.id)
      else next.add(comic.id)
      return next
    })
  }, [])

  const selectAll = useCallback((comics: ComicInfo[]) => {
    setSelectedIds(new Set(comics.map(c => c.id)))
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
