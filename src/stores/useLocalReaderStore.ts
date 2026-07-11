import { create } from 'zustand'
import type { LibraryAssetDetail } from '@shared/types'

/**
 * 本地漫画库阅读器状态。
 *
 * 与 ``useReaderStore`` 同构——把 ``LocalLibraryReaderModal`` 的开关与目标资产
 * 提升到 App 根渲染，使其脱离 keep-alive 页面 ``motion.div``（该元素的 transform
 * 会成为 fixed 定位的包含块，导致阅读器无法覆盖整个视口）。
 *
 * 关闭时保留一个 ``justClosedAssetId``，供挂载点在关闭后刷新列表/统计。
 */
interface LocalReaderState {
  readerAsset: LibraryAssetDetail | null
  open: boolean
  justClosedAssetId: string | null
  openReader: (asset: LibraryAssetDetail) => void
  closeReader: () => void
}

export const useLocalReaderStore = create<LocalReaderState>((set) => ({
  readerAsset: null,
  open: false,
  justClosedAssetId: null,
  openReader: (asset) => set({ readerAsset: asset, open: true, justClosedAssetId: null }),
  closeReader: () =>
    set((state) => ({
      open: false,
      // 资产引用延迟清除：让 modal 的关闭动画/卸载 effect 仍能读到 assetId
      justClosedAssetId: state.readerAsset?.assetId ?? null,
      readerAsset: null,
    })),
}))
