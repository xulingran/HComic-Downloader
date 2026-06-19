import { usePresenceAnimation } from './usePresenceAnimation'

/**
 * @deprecated 已委托给 `usePresenceAnimation`。
 *
 * 保留导出名以兼容 3 个调用方（Modal、ComicInfoDrawer、ComicReaderModal）。
 * 变更 2（animation-consistency）完成迁移后此文件会被删除。
 *
 * 新代码请直接使用 `usePresenceAnimation`。
 */
export function useModalAnimation(open: boolean) {
  return usePresenceAnimation(open)
}
