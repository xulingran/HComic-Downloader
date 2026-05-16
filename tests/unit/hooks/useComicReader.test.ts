import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useComicReader } from '@/hooks/useComicReader'
import type { ComicInfo } from '@shared/types'

const mockComic: ComicInfo = {
  id: '123',
  title: 'Test Comic',
  url: 'https://example.com/comic/123',
  coverUrl: 'https://example.com/cover.jpg',
  source: 'test',
  sourceSite: 'hcomic',
  mediaId: 'media123',
  pages: 5,
}

const mockPreviewResult = {
  imageUrls: [
    'https://img.example.com/page1.jpg',
    'https://img.example.com/page2.jpg',
    'https://img.example.com/page3.jpg',
  ],
  totalPages: 3,
}

describe('useComicReader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts in idle state', () => {
    const { result } = renderHook(() => useComicReader())
    expect(result.current.loadingState).toBe('idle')
    expect(result.current.imageUrls).toEqual([])
    expect(result.current.currentPage).toBe(0)
    expect(result.current.totalPages).toBe(0)
  })

  it('fetches preview URLs and transitions to loaded', async () => {
    const getPreviewUrls = vi.fn().mockResolvedValue(mockPreviewResult)
    vi.stubGlobal('hcomic', { getPreviewUrls })

    const { result } = renderHook(() => useComicReader())

    await act(async () => {
      await result.current.fetchUrls(mockComic)
    })

    expect(getPreviewUrls).toHaveBeenCalledWith(mockComic)
    expect(result.current.loadingState).toBe('loaded')
    expect(result.current.imageUrls).toEqual(mockPreviewResult.imageUrls)
    expect(result.current.totalPages).toBe(3)
  })

  it('sets loading state while preview URLs are pending', async () => {
    let resolvePreview: (value: typeof mockPreviewResult) => void = () => {}
    const pendingPreview = new Promise<typeof mockPreviewResult>((resolve) => {
      resolvePreview = resolve
    })
    const getPreviewUrls = vi.fn().mockReturnValue(pendingPreview)
    vi.stubGlobal('hcomic', { getPreviewUrls })

    const { result } = renderHook(() => useComicReader())
    let fetchPromise: Promise<void> = Promise.resolve()

    act(() => {
      fetchPromise = result.current.fetchUrls(mockComic)
    })

    expect(result.current.loadingState).toBe('loading')
    expect(result.current.errorMessage).toBe('')

    await act(async () => {
      resolvePreview(mockPreviewResult)
      await fetchPromise
    })

    expect(result.current.loadingState).toBe('loaded')
  })

  it('handles empty preview URL result', async () => {
    const getPreviewUrls = vi.fn().mockResolvedValue({ imageUrls: [], totalPages: 0 })
    vi.stubGlobal('hcomic', { getPreviewUrls })

    const { result } = renderHook(() => useComicReader())

    await act(async () => {
      await result.current.fetchUrls(mockComic)
    })

    expect(result.current.loadingState).toBe('loaded')
    expect(result.current.imageUrls).toEqual([])
    expect(result.current.currentPage).toBe(0)
    expect(result.current.totalPages).toBe(0)
  })

  it('handles fetch error and logs the failure', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('Network error')
    const getPreviewUrls = vi.fn().mockRejectedValue(error)
    vi.stubGlobal('hcomic', { getPreviewUrls })

    const { result } = renderHook(() => useComicReader())

    await act(async () => {
      await result.current.fetchUrls(mockComic)
    })

    expect(consoleErrorSpy).toHaveBeenCalledWith('[preview] fetchUrls failed', error)
    expect(result.current.loadingState).toBe('error')
    expect(result.current.errorMessage).toBe('Network error')

    consoleErrorSpy.mockRestore()
  })

  it('resets state', async () => {
    const getPreviewUrls = vi.fn().mockResolvedValue(mockPreviewResult)
    vi.stubGlobal('hcomic', { getPreviewUrls })

    const { result } = renderHook(() => useComicReader())

    await act(async () => {
      await result.current.fetchUrls(mockComic)
    })
    expect(result.current.loadingState).toBe('loaded')

    act(() => {
      result.current.reset()
    })

    expect(result.current.loadingState).toBe('idle')
    expect(result.current.imageUrls).toEqual([])
  })

  it('updates currentPage via setCurrentPage', async () => {
    const getPreviewUrls = vi.fn().mockResolvedValue(mockPreviewResult)
    vi.stubGlobal('hcomic', { getPreviewUrls })

    const { result } = renderHook(() => useComicReader())

    await act(async () => {
      await result.current.fetchUrls(mockComic)
    })

    act(() => {
      result.current.setCurrentPage(2)
    })

    expect(result.current.currentPage).toBe(2)
  })
})
