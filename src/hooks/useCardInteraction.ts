import { useCallback } from 'react'
import { ComicInfo } from '@shared/types'

interface UseCardInteractionParams {
  comic: ComicInfo
  batchMode?: boolean
  onToggleSelect?: (comic: ComicInfo) => void
  onClick?: (comic: ComicInfo) => void
  onOpenDrawer: () => void
}

export function useCardInteraction({
  comic,
  batchMode,
  onToggleSelect,
  onClick,
  onOpenDrawer,
}: UseCardInteractionParams) {
  const handleCardClick = useCallback(() => {
    if (batchMode) { onToggleSelect?.(comic); return }
    // 非批量模式：onClick 是 body 区的主路由（保留优先语义），
    // 未传入时回退到打开详情抽屉，消除卡片 body 的点击死区。
    if (onClick) { onClick(comic); return }
    onOpenDrawer()
  }, [batchMode, comic, onToggleSelect, onClick, onOpenDrawer])

  // 封面区与标题区、body 区路由统一：都打开详情抽屉。
  // SFW 仅作用于封面图片渲染（CoverImage / useCoverImage），不拦截点击导航。
  const handleReaderClick = useCallback(() => {
    if (batchMode) { onToggleSelect?.(comic); return }
    onOpenDrawer()
  }, [batchMode, comic, onToggleSelect, onOpenDrawer])

  const handleTitleClick = useCallback(() => {
    if (batchMode) {
      onToggleSelect?.(comic)
    } else {
      onOpenDrawer()
    }
  }, [batchMode, comic, onToggleSelect, onOpenDrawer])

  return { handleCardClick, handleReaderClick, handleTitleClick }
}
