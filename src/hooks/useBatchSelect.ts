import { useState, useCallback } from 'react'
import { ComicInfo } from '@shared/types'

export function getComicKey(comic: ComicInfo): string {
  return `${comic.sourceSite ?? 'hcomic'}_${comic.source ?? 'unknown'}_${comic.id}`
}

export function useBatchSelect() {
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const toggleSelect = useCallback((comic: ComicInfo) => {
    const key = getComicKey(comic)
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
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
