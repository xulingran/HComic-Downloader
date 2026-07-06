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
    if (batchMode) { onToggleSelect?.(comic); return }
    // 非批量模式：onClick 是 body 区的主路由（保留优先语义），
    // 未传入时回退到打开详情抽屉，消除卡片 body 的点击死区。
    if (onClick) { onClick(comic); return }
    onOpenDrawer()
  }, [batchMode, comic, onToggleSelect, onClick, onOpenDrawer])

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
