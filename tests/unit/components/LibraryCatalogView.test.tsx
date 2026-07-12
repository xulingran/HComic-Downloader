import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryAssetSummary } from '@shared/types'
import { useLibraryStore } from '@/stores/useLibraryStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useLocalReaderStore } from '@/stores/useLocalReaderStore'

const { libraryApi, scanApi } = vi.hoisted(() => ({
  libraryApi: {
    list: vi.fn(), stats: vi.fn(), detail: vi.fn(), cover: vi.fn(),
  },
  scanApi: { status: vi.fn(), start: vi.fn(), cancel: vi.fn() },
}))

vi.mock('@/hooks/useIpc', () => ({
  useLibrary: () => libraryApi,
  useLibraryScan: () => scanApi,
  useLibraryScanProgress: () => ({ progress: null, clear: vi.fn() }),
}))
vi.mock('@/components/library/LocalLibraryReaderModal', () => ({ LocalLibraryReaderModal: () => null }))
vi.mock('@/components/library/LibraryAssetDetailDrawer', () => ({
  LibraryAssetDetailDrawer: ({ asset, onOpenReader }: {
    asset: { assetId: string } | null
    onOpenReader: (assetId: string, mode: 'resume' | 'restart') => void
  }) => asset ? <button onClick={() => onOpenReader(asset.assetId, 'restart')}>mock restart</button> : null,
}))

class ImmediateIntersectionObserver {
  private callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) { this.callback = callback }
  observe(target: Element) {
    this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
  disconnect() {}
  unobserve() {}
  takeRecords() { return [] }
  root = null
  rootMargin = '0px'
  thresholds = [0]
}
globalThis.IntersectionObserver = ImmediateIntersectionObserver as unknown as typeof IntersectionObserver

import { LibraryCatalogView } from '@/components/library/LibraryCatalogView'

const item: LibraryAssetSummary = {
  assetId: 'asset-1', title: 'Local Comic', author: 'Author', tags: ['tag'], sourceSite: 'jm', format: 'cbz',
  pageCount: 12, sizeBytes: 1024, isAlbum: false, chapterCount: 1, coverKey: null,
  healthStatus: 'healthy', lastReadAt: null, createdAt: 1, metadataOverridden: false,
}

describe('LibraryCatalogView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useLibraryStore.getState().reset()
    useSettingsStore.setState({ sfwMode: false })
    useLocalReaderStore.setState({ readerAsset: null, launchMode: 'resume', open: false })
    libraryApi.list.mockResolvedValue({ items: [item], pagination: { currentPage: 1, totalPages: 1, totalItems: 1 } })
    libraryApi.stats.mockResolvedValue({
      totalAssets: 1, totalPages: 12, totalSizeBytes: 1024,
      byFormat: { cbz: 1, zip: 0, folder: 0 }, bySource: { jm: 1 }, byHealth: { healthy: 1 },
    })
    libraryApi.cover.mockResolvedValue({ coverKey: 'a'.repeat(64), mediaType: 'image/jpeg' })
    libraryApi.detail.mockResolvedValue({ ...item, chapters: [], readingPage: 8, readingChapterId: null, version: 1 })
    scanApi.status.mockResolvedValue({
      phase: 'idle', scanId: null, isScanning: false, current: 0, total: 0, currentLabel: '',
      lastScanCompletedAt: 1, lastScanCancelled: false, lastScanError: null,
    })
  })

  it('offers source and health filters, list view, and lazy local covers', async () => {
    render(<LibraryCatalogView />)
    expect(await screen.findByText('Local Comic')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByTestId('library-source-filter'), 'jm')
    await userEvent.selectOptions(screen.getByTestId('library-health-filter'), 'healthy')
    await userEvent.click(screen.getByRole('button', { name: '列表视图' }))

    expect(screen.getByTestId('library-source-filter')).toHaveValue('jm')
    expect(screen.getByTestId('library-health-filter')).toHaveValue('healthy')
    expect(screen.getByTestId('library-list')).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: 'Local Comic' })).toHaveAttribute(
      'src', `app-image://library/${'a'.repeat(64)}`,
    )
  })

  it('refreshes detail and forwards the selected launch mode to the root reader store', async () => {
    render(<LibraryCatalogView />)
    await userEvent.click(await screen.findByTestId('library-card-asset-1'))
    await userEvent.click(await screen.findByRole('button', { name: 'mock restart' }))

    expect(libraryApi.detail).toHaveBeenCalledTimes(2)
    expect(useLocalReaderStore.getState()).toMatchObject({
      readerAsset: expect.objectContaining({ assetId: 'asset-1' }),
      launchMode: 'restart',
      open: true,
    })
  })
})
