import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryAssetDetail } from '@shared/types'

class NoopIntersectionObserver {
  constructor(_callback: IntersectionObserverCallback) {}
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() { return [] }
  root = null
  rootMargin = '0px'
  thresholds = [0]
}
globalThis.IntersectionObserver = NoopIntersectionObserver as unknown as typeof IntersectionObserver

const { libraryApi } = vi.hoisted(() => ({
  libraryApi: {
    detail: vi.fn(),
    pageManifest: vi.fn(),
    getPage: vi.fn(),
    saveReadingProgress: vi.fn(),
  },
}))

vi.mock('@/hooks/useIpc', () => ({ useLibrary: () => libraryApi }))
vi.mock('@/components/ReaderPage', () => ({
  ReaderPage: ({ index }: { index: number }) => <div data-testid={`local-reader-page-${index}`}>page {index + 1}</div>,
}))
vi.mock('@/components/PageFlipView', () => ({
  PageFlipView: () => <div data-testid="local-page-flip">page flip</div>,
}))

import { LocalLibraryReaderModal } from '@/components/library/LocalLibraryReaderModal'

const asset: LibraryAssetDetail = {
  assetId: 'asset-1', title: 'Album', author: 'Author', tags: [], sourceSite: '', comicId: '', comicSource: '',
  albumId: '', albumTotalChapters: 2, format: 'folder', pageCount: 4, sizeBytes: 10, modifiedAt: 1,
  chapters: [
    { chapterId: 'ch1', name: '第一章', index: 0, pageCount: 2 },
    { chapterId: 'ch2', name: '第二章', index: 1, pageCount: 2 },
  ],
  coverKey: null, healthStatus: 'unknown', lastReadAt: null, readingPage: null, readingChapterId: null,
  pathSummary: 'Album', metadataOverridden: false, version: 1,
}

describe('LocalLibraryReaderModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.setItem('hcomic-reader-display-mode', 'scroll')
    libraryApi.detail.mockResolvedValue(asset)
    libraryApi.pageManifest.mockImplementation((_assetId: string, chapterId?: string) => Promise.resolve({
      chapterId: chapterId ?? 'ch1', version: 1,
      pages: [{ index: 0, mediaType: 'image/jpeg' }, { index: 1, mediaType: 'image/jpeg' }],
    }))
    libraryApi.getPage.mockResolvedValue({ imageUrl: 'app-image://library/hash', version: 1, mediaType: 'image/jpeg' })
    libraryApi.saveReadingProgress.mockResolvedValue({ success: true })
  })

  it('enters the selected chapter instead of remaining on the chapter picker', async () => {
    render(<LocalLibraryReaderModal asset={asset} open onClose={() => {}} />)

    await screen.findByText(/请选择章节 · 共 2 章/)
    await userEvent.click(screen.getByText('第二章').closest('button')!)

    await waitFor(() => expect(screen.queryByText(/请选择章节 · 共 2 章/)).not.toBeInTheDocument())
    expect(await screen.findByTestId('local-reader-page-0')).toHaveTextContent('page 1')
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
  })

  it('uses the shared page-flip surface when switching to double-page mode', async () => {
    const singleChapterAsset = { ...asset, chapters: [asset.chapters[0]], albumTotalChapters: 1 }
    libraryApi.detail.mockResolvedValue(singleChapterAsset)
    render(<LocalLibraryReaderModal asset={singleChapterAsset} open onClose={() => {}} />)
    await screen.findByTestId('local-reader-page-0')
    await userEvent.click(screen.getByRole('button', { name: '设置' }))
    await userEvent.selectOptions(screen.getByLabelText('模式'), 'double')
    expect(await screen.findByTestId('local-page-flip')).toBeInTheDocument()
  })
})
