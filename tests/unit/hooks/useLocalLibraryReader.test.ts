import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryAssetDetail, LibraryPageManifest } from '@shared/types'

const { libraryApi } = vi.hoisted(() => ({
  libraryApi: {
    detail: vi.fn(),
    pageManifest: vi.fn(),
    getPage: vi.fn(),
    saveReadingProgress: vi.fn(),
  },
}))

vi.mock('@/hooks/useIpc', () => ({ useLibrary: () => libraryApi }))

import { useLocalLibraryReader } from '@/hooks/useLocalLibraryReader'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createAsset(
  assetId: string,
  options: Partial<LibraryAssetDetail> = {},
): LibraryAssetDetail {
  return {
    assetId,
    title: `Asset ${assetId}`,
    author: 'Author',
    tags: [],
    sourceSite: '',
    comicId: '',
    comicSource: '',
    albumId: '',
    albumTotalChapters: 2,
    format: 'folder',
    pageCount: 5,
    sizeBytes: 10,
    modifiedAt: 1,
    chapters: [
      { chapterId: 'ch1', name: 'Chapter 1', index: 0, pageCount: 2 },
      { chapterId: 'ch2', name: 'Chapter 2', index: 1, pageCount: 3 },
    ],
    coverKey: null,
    healthStatus: 'unknown',
    lastReadAt: null,
    readingPage: null,
    readingChapterId: null,
    pathSummary: assetId,
    metadataOverridden: false,
    version: 1,
    ...options,
  }
}

function createManifest(chapterId: string, pageCount: number, version = 1): LibraryPageManifest {
  return {
    chapterId,
    version,
    pages: Array.from({ length: pageCount }, (_, index) => ({ index, mediaType: 'image/jpeg' })),
  }
}

describe('useLocalLibraryReader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ignores a stale asset request that finishes after a newer asset', async () => {
    const oldDetail = createDeferred<LibraryAssetDetail>()
    const newDetail = createDeferred<LibraryAssetDetail>()
    libraryApi.detail.mockImplementation((assetId: string) => (
      assetId === 'old' ? oldDetail.promise : newDetail.promise
    ))
    libraryApi.pageManifest.mockImplementation((assetId: string, chapterId?: string) => (
      Promise.resolve(createManifest(chapterId ?? 'default', assetId === 'new' ? 3 : 1, assetId === 'new' ? 2 : 1))
    ))
    const { result } = renderHook(() => useLocalLibraryReader())
    let oldRequest!: Promise<void>
    let newRequest!: Promise<void>

    act(() => {
      oldRequest = result.current.fetchAsset('old', 'ch1', 1)
      newRequest = result.current.fetchAsset('new', 'ch2', 2)
    })

    await act(async () => {
      newDetail.resolve(createAsset('new', { version: 2 }))
      await newRequest
    })
    await act(async () => {
      oldDetail.resolve(createAsset('old'))
      await oldRequest
    })

    expect(result.current.loadingState).toBe('loaded')
    expect(result.current.currentChapterId).toBe('ch2')
    expect(result.current.currentPage).toBe(2)
    expect(result.current.assetVersion).toBe(2)
    expect(result.current.imageUrls).toEqual([
      'library://new/ch2/1/2',
      'library://new/ch2/2/2',
      'library://new/ch2/3/2',
    ])
  })

  it('ignores stale chapter success after a newer chapter succeeds', async () => {
    const firstChapter = createDeferred<LibraryPageManifest>()
    const secondChapter = createDeferred<LibraryPageManifest>()
    libraryApi.detail.mockResolvedValue(createAsset('asset'))
    libraryApi.pageManifest.mockImplementation((_assetId: string, chapterId?: string) => {
      if (chapterId === 'ch1') return firstChapter.promise
      if (chapterId === 'ch2') return secondChapter.promise
      return Promise.resolve(createManifest('default', 1))
    })
    const { result } = renderHook(() => useLocalLibraryReader())
    let firstRequest!: Promise<void>
    let secondRequest!: Promise<void>

    act(() => {
      firstRequest = result.current.goToChapter('asset', 'ch1')
      secondRequest = result.current.goToChapter('asset', 'ch2')
    })
    await act(async () => {
      secondChapter.resolve(createManifest('ch2', 3))
      await secondRequest
    })
    await act(async () => {
      firstChapter.resolve(createManifest('ch1', 2))
      await firstRequest
    })

    expect(result.current.loadingState).toBe('loaded')
    expect(result.current.currentChapterId).toBe('ch2')
    expect(result.current.totalPages).toBe(3)
    expect(result.current.imageUrls).toEqual([
      'library://asset/ch2/1/1',
      'library://asset/ch2/2/1',
      'library://asset/ch2/3/1',
    ])
  })

  it('ignores stale chapter failure after a newer chapter succeeds', async () => {
    const firstChapter = createDeferred<LibraryPageManifest>()
    const secondChapter = createDeferred<LibraryPageManifest>()
    libraryApi.pageManifest.mockImplementation((_assetId: string, chapterId?: string) => (
      chapterId === 'ch1' ? firstChapter.promise : secondChapter.promise
    ))
    const { result } = renderHook(() => useLocalLibraryReader())
    let firstRequest!: Promise<void>
    let secondRequest!: Promise<void>

    act(() => {
      firstRequest = result.current.goToChapter('asset', 'ch1')
      secondRequest = result.current.goToChapter('asset', 'ch2')
    })
    await act(async () => {
      secondChapter.resolve(createManifest('ch2', 2))
      await secondRequest
    })
    await act(async () => {
      firstChapter.reject(new Error('old chapter failed'))
      await firstRequest.catch(() => undefined)
    })

    expect(result.current.loadingState).toBe('loaded')
    expect(result.current.errorMessage).toBeNull()
    expect(result.current.currentChapterId).toBe('ch2')
    expect(result.current.totalPages).toBe(2)
  })

  it('preserves the current chapter and page when a chapter transition fails', async () => {
    libraryApi.detail.mockResolvedValue(createAsset('asset'))
    libraryApi.pageManifest.mockImplementation((_assetId: string, chapterId?: string) => {
      if (chapterId === 'ch2') return Promise.reject(new Error('manifest failed'))
      return Promise.resolve(createManifest(chapterId ?? 'default', 2))
    })
    const { result } = renderHook(() => useLocalLibraryReader())

    await act(async () => {
      await result.current.fetchAsset('asset', 'ch1', 2)
    })

    await act(async () => {
      await result.current.goToChapter('asset', 'ch2').catch(() => undefined)
    })

    expect(result.current.loadingState).toBe('error')
    expect(result.current.currentChapterId).toBe('ch1')
    expect(result.current.currentPage).toBe(2)
    expect(result.current.totalPages).toBe(2)
    expect(result.current.imageUrls).toEqual([
      'library://asset/ch1/1/1',
      'library://asset/ch1/2/1',
    ])
  })

  it('reset invalidates a pending request', async () => {
    const detail = createDeferred<LibraryAssetDetail>()
    libraryApi.detail.mockReturnValue(detail.promise)
    libraryApi.pageManifest.mockResolvedValue(createManifest('ch1', 2))
    const { result } = renderHook(() => useLocalLibraryReader())
    let request!: Promise<void>

    act(() => {
      request = result.current.fetchAsset('asset', 'ch1', 2)
    })
    act(() => {
      result.current.reset()
    })
    await act(async () => {
      detail.resolve(createAsset('asset'))
      await request
    })

    expect(result.current.loadingState).toBe('idle')
    expect(result.current.errorMessage).toBeNull()
    expect(result.current.chapters).toEqual([])
    expect(result.current.currentChapterId).toBeNull()
    expect(result.current.imageUrls).toEqual([])
    expect(result.current.totalPages).toBe(0)
    expect(result.current.currentPage).toBe(1)
    expect(result.current.assetVersion).toBe(1)
  })

  it('loads multi-chapter detail without choosing an implicit chapter', async () => {
    libraryApi.detail.mockResolvedValue(createAsset('asset'))
    const { result } = renderHook(() => useLocalLibraryReader())

    await act(async () => {
      await result.current.fetchAsset('asset', null, null)
    })

    expect(libraryApi.detail).toHaveBeenCalledWith('asset')
    expect(libraryApi.pageManifest).not.toHaveBeenCalled()
    expect(result.current.loadingState).toBe('loaded')
    expect(result.current.chapters.map((chapter) => chapter.id)).toEqual(['ch1', 'ch2'])
    expect(result.current.currentChapterId).toBeNull()
    expect(result.current.imageUrls).toEqual([])
    expect(result.current.totalPages).toBe(0)
    expect(result.current.currentPage).toBe(1)
  })

  it('requires chapter selection when the saved chapter is invalid', async () => {
    libraryApi.detail.mockResolvedValue(createAsset('asset'))
    const { result } = renderHook(() => useLocalLibraryReader())

    await act(async () => {
      await result.current.fetchAsset('asset', 'missing', 4)
    })

    expect(libraryApi.pageManifest).not.toHaveBeenCalled()
    expect(result.current.loadingState).toBe('loaded')
    expect(result.current.currentChapterId).toBeNull()
    expect(result.current.imageUrls).toEqual([])
    expect(result.current.currentPage).toBe(1)
  })

  it('synthesizes and loads the default chapter for a chapterless asset', async () => {
    const chapterless = createAsset('single', {
      title: 'Single volume',
      albumTotalChapters: 1,
      pageCount: 2,
      chapters: [],
      version: 3,
    })
    libraryApi.detail.mockResolvedValue(chapterless)
    libraryApi.pageManifest.mockResolvedValue(createManifest('default', 2, 3))
    const { result } = renderHook(() => useLocalLibraryReader())

    await act(async () => {
      await result.current.fetchAsset('single', null, null)
    })

    expect(libraryApi.pageManifest).toHaveBeenCalledWith('single', 'default')
    expect(result.current.loadingState).toBe('loaded')
    expect(result.current.chapters).toEqual([{ id: 'default', name: 'Single volume', index: 0, pages: 2 }])
    expect(result.current.currentChapterId).toBe('default')
    expect(result.current.imageUrls).toEqual([
      'library://single/default/1/3',
      'library://single/default/2/3',
    ])
  })

  it('restores a valid saved chapter and clamps its saved page', async () => {
    libraryApi.detail.mockResolvedValue(createAsset('asset', { version: 4 }))
    libraryApi.pageManifest.mockResolvedValue(createManifest('ch2', 3, 4))
    const { result } = renderHook(() => useLocalLibraryReader())

    await act(async () => {
      await result.current.fetchAsset('asset', 'ch2', 99)
    })

    expect(libraryApi.pageManifest).toHaveBeenCalledWith('asset', 'ch2')
    expect(result.current.loadingState).toBe('loaded')
    expect(result.current.currentChapterId).toBe('ch2')
    expect(result.current.currentPage).toBe(3)
    expect(result.current.totalPages).toBe(3)
    expect(result.current.assetVersion).toBe(4)
  })
})
