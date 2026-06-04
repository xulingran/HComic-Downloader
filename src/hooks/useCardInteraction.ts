import { useCallback } from 'react'
import { ComicInfo } from '@shared/types'

interface UseCardInteractionParams {
  comic: ComicInfo
  batchMode?: boolean
  sfwMode: boolean
  onToggleSelect?: (comic: ComicInfo) => void
  onClick?: (comic: ComicInfo) => void
  onOpenDrawer: () => void
  onOpenReader?: (comic: ComicInfo) => void
}

export function useCardInteraction({
  comic,
  batchMode,
  sfwMode,
  onToggleSelect,
  onClick,
  onOpenDrawer,
  onOpenReader,
}: UseCardInteractionParams) {
  const handleCardClick = useCallback(() => {
    if (batchMode) onToggleSelect?.(comic)
    else onClick?.(comic)
  }, [batchMode, comic, onToggleSelect, onClick])

  const handleReaderClick = useCallback(() => {
    if (batchMode) { onToggleSelect?.(comic); return }
    if (!sfwMode && onOpenReader) {
      onOpenReader(comic)
    }
  }, [batchMode, sfwMode, comic, onToggleSelect, onOpenReader])

  const handleTitleClick = useCallback(() => {
    if (batchMode) {
      onToggleSelect?.(comic)
    } else {
      onOpenDrawer()
    }
  }, [batchMode, comic, onToggleSelect, onOpenDrawer])

  return { handleCardClick, handleReaderClick, handleTitleClick }
}
