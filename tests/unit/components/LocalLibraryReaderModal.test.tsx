import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryAssetDetail } from '@shared/types'

let latestIntersectionCallback: IntersectionObserverCallback | null = null

class NoopIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    latestIntersectionCallback = callback
  }
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() { return [] }
  root = null
  rootMargin = '0px'
  thresholds = [0]
}
globalThis.IntersectionObserver = NoopIntersectionObserver as unknown as typeof IntersectionObserver

const { libraryApi, pageLoaded } = vi.hoisted(() => ({
  libraryApi: {
    detail: vi.fn(),
    pageManifest: vi.fn(),
    getPage: vi.fn(),
    saveReadingProgress: vi.fn(),
  },
  pageLoaded: vi.fn(),
}))

vi.mock('@/hooks/useIpc', () => ({ useLibrary: () => libraryApi }))
vi.mock('@/components/ReaderPage', () => ({
  ReaderPage: ({
    url,
    index,
    imageLoader,
    onCached,
  }: {
    url: string
    index: number
    imageLoader: (url: string, index: number) => Promise<string>
    onCached: (index: number, imageUrl: string) => void
  }) => (
    <button
      data-testid={`local-reader-page-${index}`}
      onClick={() => {
        void imageLoader(url, index)
          .then((imageUrl) => {
            onCached(index, imageUrl)
            pageLoaded(imageUrl)
          })
          .catch(() => {})
      }}
    >
      page {index + 1}
    </button>
  ),
}))
vi.mock('@/components/PageFlipView', () => ({
  PageFlipView: ({ currentPage }: { currentPage: number }) => (
    <div data-testid="local-page-flip">page {currentPage}</div>
  ),
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
    latestIntersectionCallback = null
    localStorage.setItem('hcomic-reader-display-mode', 'scroll')
    libraryApi.detail.mockResolvedValue(asset)
    libraryApi.pageManifest.mockImplementation((_assetId: string, chapterId?: string) => Promise.resolve({
      chapterId: chapterId ?? 'ch1', version: 1,
      pages: [{ index: 0, mediaType: 'image/jpeg' }, { index: 1, mediaType: 'image/jpeg' }],
    }))
    libraryApi.getPage.mockResolvedValue({ imageUrl: 'app-image://library/hash', version: 1, mediaType: 'image/jpeg' })
    libraryApi.saveReadingProgress.mockResolvedValue({ success: true })
  })

  function createDeferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((resolvePromise) => {
      resolve = resolvePromise
    })
    return { promise, resolve }
  }

  it('enters the selected chapter instead of remaining on the chapter picker', async () => {
    render(<LocalLibraryReaderModal asset={asset} open onClose={() => {}} />)

    await screen.findByText(/请选择章节 · 共 2 章/)
    await userEvent.click(screen.getByText('第二章').closest('button')!)

    await waitFor(() => expect(screen.queryByText(/请选择章节 · 共 2 章/)).not.toBeInTheDocument())
    expect(await screen.findByTestId('local-reader-page-0')).toHaveTextContent('page 1')
    expect(screen.getAllByText('1 / 2').length).toBeGreaterThanOrEqual(1)
  })

  it('shows the chapter picker when the saved chapter is invalid without loading an implicit manifest', async () => {
    const assetWithInvalidProgress = {
      ...asset,
      readingChapterId: 'missing-chapter',
      readingPage: 2,
    }
    libraryApi.detail.mockResolvedValue(assetWithInvalidProgress)

    render(<LocalLibraryReaderModal asset={assetWithInvalidProgress} open onClose={() => {}} />)

    expect(await screen.findByText(/请选择章节 · 共 2 章/)).toBeInTheDocument()
    expect(screen.getByText('第一章')).toBeInTheDocument()
    expect(screen.getByText('第二章')).toBeInTheDocument()
    expect(libraryApi.pageManifest).not.toHaveBeenCalled()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(screen.queryByText('1 / 0')).not.toBeInTheDocument()
  })

  it('reopens the chapter picker after selecting or resuming a chapter', async () => {
    const resumedAsset = { ...asset, readingChapterId: 'ch2', readingPage: 2 }
    libraryApi.detail.mockResolvedValue(resumedAsset)
    render(<LocalLibraryReaderModal asset={resumedAsset} open onClose={() => {}} />)

    await screen.findByTestId('local-reader-page-0')
    await userEvent.click(screen.getByLabelText('章节列表'))

    expect(await screen.findByText(/请选择章节 · 共 2 章/)).toBeInTheDocument()
    expect(screen.getByText('第一章')).toBeInTheDocument()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })

  it('does not persist page one for the old chapter when a chapter transition fails', async () => {
    const resumedAsset = { ...asset, readingChapterId: 'ch1', readingPage: 2 }
    libraryApi.detail.mockResolvedValue(resumedAsset)
    libraryApi.pageManifest.mockImplementation((_assetId: string, chapterId?: string) => {
      if (chapterId === 'ch2') return Promise.reject(new Error('manifest failed'))
      return Promise.resolve({
        chapterId: chapterId ?? 'ch1',
        version: 1,
        pages: [{ index: 0, mediaType: 'image/jpeg' }, { index: 1, mediaType: 'image/jpeg' }],
      })
    })
    render(<LocalLibraryReaderModal asset={resumedAsset} open onClose={() => {}} />)

    await screen.findByTestId('local-reader-page-0')
    await userEvent.click(screen.getByLabelText('章节列表'))
    await userEvent.click(screen.getByText('第二章').closest('button')!)
    expect(await screen.findByText('manifest failed')).toBeInTheDocument()

    expect(libraryApi.saveReadingProgress).not.toHaveBeenCalledWith('asset-1', 'ch1', 1, 2)
  })

  it('does not let a stale page request overwrite the new chapter cache', async () => {
    const chapterOnePage = createDeferred<{ imageUrl: string; version: number; mediaType: string }>()
    const chapterTwoPage = createDeferred<{ imageUrl: string; version: number; mediaType: string }>()
    libraryApi.getPage.mockImplementation((_assetId: string, chapterId: string) => (
      chapterId === 'ch1' ? chapterOnePage.promise : chapterTwoPage.promise
    ))
    render(<LocalLibraryReaderModal asset={asset} open onClose={() => {}} />)

    await screen.findByText(/请选择章节 · 共 2 章/)
    await userEvent.click(screen.getByText('第一章').closest('button')!)
    await userEvent.click(await screen.findByTestId('local-reader-page-0'))
    await userEvent.click(screen.getByLabelText('章节列表'))
    await userEvent.click(screen.getByText('第二章').closest('button')!)
    await userEvent.click(await screen.findByTestId('local-reader-page-0'))

    await act(async () => {
      chapterTwoPage.resolve({ imageUrl: 'app-image://library/chapter-two', version: 1, mediaType: 'image/jpeg' })
      await chapterTwoPage.promise
    })
    await waitFor(() => expect(pageLoaded).toHaveBeenCalledWith('app-image://library/chapter-two'))
    await act(async () => {
      chapterOnePage.resolve({ imageUrl: 'app-image://library/chapter-one', version: 1, mediaType: 'image/jpeg' })
      await chapterOnePage.promise
      await Promise.resolve()
    })
    expect(pageLoaded).not.toHaveBeenCalledWith('app-image://library/chapter-one')

    await userEvent.click(screen.getByTestId('local-reader-page-0'))
    await waitFor(() => expect(pageLoaded).toHaveBeenLastCalledWith('app-image://library/chapter-two'))
    expect(libraryApi.getPage).toHaveBeenCalledTimes(2)
  })

  it('closes the reader from the error state and exposes retry separately', async () => {
    const onClose = vi.fn()
    libraryApi.detail.mockRejectedValue(new Error('detail failed'))
    render(<LocalLibraryReaderModal asset={asset} open onClose={onClose} />)

    expect(await screen.findByText('detail failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
    const closeButtons = screen.getAllByRole('button', { name: '关闭' })
    await userEvent.click(closeButtons[closeButtons.length - 1]!)

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(libraryApi.detail).toHaveBeenCalledTimes(1)
  })

  it('uses the shared page-flip surface when switching to double-page mode', async () => {
    const singleChapterAsset = { ...asset, chapters: [asset.chapters[0]], albumTotalChapters: 1 }
    libraryApi.detail.mockResolvedValue(singleChapterAsset)
    render(<LocalLibraryReaderModal asset={singleChapterAsset} open onClose={() => {}} />)
    await screen.findByTestId('local-reader-page-0')
    await userEvent.click(screen.getByLabelText('阅读设置'))
    await userEvent.click(screen.getByLabelText('双页显示'))
    expect(await screen.findByTestId('local-page-flip')).toBeInTheDocument()
  })

  it('drags the progress bar to the matching scroll page without observer rollback', async () => {
    const pages = Array.from({ length: 10 }, (_, index) => ({ index, mediaType: 'image/jpeg' }))
    const singleChapterAsset = {
      ...asset,
      chapters: [{ ...asset.chapters[0], pageCount: 10 }],
      albumTotalChapters: 1,
      pageCount: 10,
    }
    libraryApi.detail.mockResolvedValue(singleChapterAsset)
    libraryApi.pageManifest.mockResolvedValue({ chapterId: 'ch1', version: 1, pages })
    render(<LocalLibraryReaderModal asset={singleChapterAsset} open onClose={() => {}} />)

    const slider = await screen.findByRole('slider')
    slider.getBoundingClientRect = vi.fn(() => ({
      left: 0, width: 200, right: 200, top: 0, bottom: 24, height: 24, x: 0, y: 0,
    }) as DOMRect)
    slider.setPointerCapture = vi.fn()
    const targetPage = screen.getByTestId('local-reader-page-4').parentElement!
    targetPage.scrollIntoView = vi.fn()

    fireEvent.pointerDown(slider, { clientX: 100, pointerId: 1 })
    expect(slider).toHaveAttribute('aria-valuenow', '5')
    expect(targetPage.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ behavior: 'instant', block: 'start' })

    const oldPage = screen.getByTestId('local-reader-page-0').parentElement!
    act(() => {
      latestIntersectionCallback?.(
        [{ isIntersecting: true, target: oldPage, boundingClientRect: { top: 0 } }] as unknown as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      )
    })
    expect(slider).toHaveAttribute('aria-valuenow', '5')
  })

  it('jumps directly in single mode and respects the double-page front blank endpoint', async () => {
    const singleChapterAsset = { ...asset, chapters: [asset.chapters[0]], albumTotalChapters: 1 }
    libraryApi.detail.mockResolvedValue(singleChapterAsset)
    render(<LocalLibraryReaderModal asset={singleChapterAsset} open onClose={() => {}} />)
    await screen.findByTestId('local-reader-page-0')

    await userEvent.click(screen.getByLabelText('阅读设置'))
    await userEvent.click(screen.getByLabelText('单页显示'))
    let slider = screen.getByRole('slider', { name: '页面进度' })
    slider.getBoundingClientRect = vi.fn(() => ({
      left: 0, width: 200, right: 200, top: 0, bottom: 24, height: 24, x: 0, y: 0,
    }) as DOMRect)
    slider.setPointerCapture = vi.fn()
    fireEvent.pointerDown(slider, { clientX: 200, pointerId: 2 })
    expect(screen.getByTestId('local-page-flip')).toHaveTextContent('page 2')
    fireEvent.pointerUp(slider, { pointerId: 2 })

    await userEvent.click(screen.getByLabelText('双页显示'))
    await userEvent.click(screen.getByLabelText('前补白'))
    slider = screen.getByRole('slider', { name: '页面进度' })
    slider.getBoundingClientRect = vi.fn(() => ({
      left: 0, width: 200, right: 200, top: 0, bottom: 24, height: 24, x: 0, y: 0,
    }) as DOMRect)
    slider.setPointerCapture = vi.fn()
    fireEvent.pointerDown(slider, { clientX: 200, pointerId: 3 })

    expect(slider).toHaveAttribute('aria-valuemax', '3')
    expect(screen.getByTestId('local-page-flip')).toHaveTextContent('page 3')
    expect(libraryApi.getPage.mock.calls.every((call) => Number(call[2]) <= 2)).toBe(true)
  })
})
