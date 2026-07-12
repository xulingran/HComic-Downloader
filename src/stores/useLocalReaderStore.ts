import { create } from 'zustand'
import type { LibraryAssetDetail } from '@shared/types'

export type LocalReaderLaunchMode = 'resume' | 'restart'

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
  launchMode: LocalReaderLaunchMode
  open: boolean
  sessionId: number
  closingSessionId: number | null
  justClosedAssetId: string | null
  openReader: (asset: LibraryAssetDetail, launchMode?: LocalReaderLaunchMode) => void
  closeReader: () => void
  finalizeClose: (sessionId: number | null) => void
}

export const useLocalReaderStore = create<LocalReaderState>((set) => ({
  readerAsset: null,
  launchMode: 'resume',
  open: false,
  sessionId: 0,
  closingSessionId: null,
  justClosedAssetId: null,
  openReader: (asset, launchMode = 'resume') => set((state) => ({
    readerAsset: asset,
    launchMode,
    open: true,
    sessionId: state.sessionId + 1,
    closingSessionId: null,
    justClosedAssetId: null,
  })),
  closeReader: () =>
    set((state) => state.open ? ({
      open: false,
      closingSessionId: state.sessionId,
      justClosedAssetId: state.readerAsset?.assetId ?? null,
    }) : state),
  finalizeClose: (sessionId) =>
    set((state) => (
      sessionId !== null
      && !state.open
      && state.closingSessionId === sessionId
      && state.sessionId === sessionId
    ) ? {
        readerAsset: null,
        closingSessionId: null,
      } : state),
}))
