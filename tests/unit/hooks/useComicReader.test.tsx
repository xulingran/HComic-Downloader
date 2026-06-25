import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useComicReader } from '@/hooks/useComicReader'
import { createMockHcomic } from '../../__mocks__/ipc'
import type { ComicInfo } from '@shared/types'

const jmComic = { id: '999001', sourceSite: 'jm', source: 'JM' } as ComicInfo

describe('useComicReader', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as unknown as Record<string, unknown>).hcomic
  })

  it('stores chapters from getPreviewUrls', async () => {
    createMockHcomic({
      getPreviewUrls: vi.fn().mockResolvedValue({
        imageUrls: [], totalPages: 0,
        chapters: [{ id: '999001', name: '第 1 話', index: 1 }],
        albumId: '999001', albumTotalChapters: 1,
      }),
    })
    const { result } = renderHook(() => useComicReader())
    await act(async () => { await result.current.fetchUrls(jmComic) })
    expect(result.current.chapters).toHaveLength(1)
    expect(result.current.chapters[0].id).toBe('999001')
  })

  it('fetchChapterUrls loads images and scramble metadata', async () => {
    createMockHcomic({
      getChapterPreviewUrls: vi.fn().mockResolvedValue({
        imageUrls: ['https://cdn/media/photos/999002/00001.webp'],
        totalPages: 1, scrambleId: '220980', comicId: '999002',
      }),
    })
    const { result } = renderHook(() => useComicReader())
    await act(async () => { await result.current.fetchChapterUrls('999002', '999001') })
    expect(result.current.imageUrls).toHaveLength(1)
    expect(result.current.scrambleId).toBe('220980')
    expect(result.current.comicId).toBe('999002')
    expect(result.current.currentPage).toBe(1)
    expect(result.current.loadingState).toBe('loaded')
  })

  it('reset clears chapters', async () => {
    createMockHcomic({
      getPreviewUrls: vi.fn().mockResolvedValue({
        imageUrls: [], totalPages: 0,
        chapters: [{ id: '999001', name: '第 1 話', index: 1 }],
      }),
    })
    const { result } = renderHook(() => useComicReader())
    await act(async () => { await result.current.fetchUrls(jmComic) })
    act(() => { result.current.reset() })
    expect(result.current.chapters).toHaveLength(0)
  })
})
