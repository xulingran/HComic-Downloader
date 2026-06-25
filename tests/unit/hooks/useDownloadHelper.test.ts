import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDownloadHelper } from '@/hooks/useDownloadHelper'
import { useDownloadStore } from '@/stores/useDownloadStore'
import { createMockHcomic } from '../../__mocks__/ipc'
import type { ComicInfo } from '@shared/types'

const mockComic: ComicInfo = {
  id: 'comic-1',
  title: 'Test Comic',
  url: 'https://example.com/1',
  coverUrl: 'https://example.com/cover.jpg',
  source: 'hcomic',
}

describe('useDownloadHelper', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useDownloadStore.getState().setTasks([])
    delete (window as unknown as Record<string, unknown>).hcomic
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('should download without overwrite when no conflict', async () => {
    const hcomic = createMockHcomic({
      checkDownloadConflict: vi.fn().mockResolvedValue({ hasConflict: false, path: '' }),
      download: vi.fn().mockResolvedValue({ taskId: 't1', status: 'queued' }),
    })

    const { result } = renderHook(() => useDownloadHelper())
    const returned = await result.current.downloadWithConflictCheck(mockComic)

    expect(returned).toBe(true)
    expect(hcomic.checkDownloadConflict).toHaveBeenCalledWith(mockComic)
    expect(hcomic.download).toHaveBeenCalledWith('comic-1', mockComic, undefined)
  })

  it('should download with overwrite when conflict and user confirms', async () => {
    const hcomic = createMockHcomic({
      checkDownloadConflict: vi.fn().mockResolvedValue({ hasConflict: true, path: '/path/to/file' }),
      download: vi.fn().mockResolvedValue({ taskId: 't2', status: 'queued' }),
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const { result } = renderHook(() => useDownloadHelper())
    const returned = await result.current.downloadWithConflictCheck(mockComic)

    expect(returned).toBe(true)
    expect(window.confirm).toHaveBeenCalled()
    expect(hcomic.download).toHaveBeenCalledWith('comic-1', mockComic, true)
  })

  it('should not download when conflict and user cancels', async () => {
    createMockHcomic({
      checkDownloadConflict: vi.fn().mockResolvedValue({ hasConflict: true, path: '/path/to/file' }),
      download: vi.fn().mockResolvedValue({ taskId: 't3', status: 'queued' }),
    })
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    const { result } = renderHook(() => useDownloadHelper())
    const returned = await result.current.downloadWithConflictCheck(mockComic)

    expect(returned).toBe(false)
  })

  it('should return false on error', async () => {
    createMockHcomic({
      checkDownloadConflict: vi.fn().mockRejectedValue(new Error('IPC error')),
      download: vi.fn(),
    })

    const { result } = renderHook(() => useDownloadHelper())
    const returned = await result.current.downloadWithConflictCheck(mockComic)

    expect(returned).toBe(false)
  })

  describe('downloadBatchAsAlbum', () => {
    it('upserts each returned task with its matching comic', async () => {
      const comics: ComicInfo[] = [
        { ...mockComic, id: 'comic-a', title: 'Comic A', pages: 12, sourceSite: 'hcomic', source: 'MMCG_SHORT' },
        { ...mockComic, id: 'comic-b', title: 'Comic B', pages: 34, sourceSite: 'jm', source: 'JM' },
      ]
      createMockHcomic({
        downloadBatchAsAlbum: vi.fn().mockResolvedValue({
          taskIds: ['hcomic_MMCG_SHORT_comic-a', 'jm_JM_comic-b'],
          queuedTasks: [
            { taskId: 'hcomic_MMCG_SHORT_comic-a', comicId: 'comic-a', sourceSite: 'hcomic', source: 'MMCG_SHORT' },
            { taskId: 'jm_JM_comic-b', comicId: 'comic-b', sourceSite: 'jm', source: 'JM' },
          ],
          status: 'queued',
        }),
      })

      const { result } = renderHook(() => useDownloadHelper())
      const ok = await result.current.downloadBatchAsAlbum(comics, 'Custom Album')

      expect(ok).toEqual({ success: true, failedCount: 0 })
      const tasks = useDownloadStore.getState().tasks
      expect(tasks.map((task) => task.comic.title)).toEqual(['Comic A', 'Comic B'])
      expect(tasks.map((task) => task.totalPages)).toEqual([12, 34])
    })
  })

  describe('downloadChapters', () => {
    const multiChapterComic: ComicInfo = {
      ...mockComic,
      id: '999001',
      source: 'JM',
      pages: 60,
    }

    it('downloads selected chapters with chapterIds and upserts a task per returned taskId', async () => {
      const hcomic = createMockHcomic({
        download: vi.fn().mockResolvedValue({ taskIds: ['t-a', 't-b'], status: 'queued' }),
      })

      const { result } = renderHook(() => useDownloadHelper())
      const ok = await result.current.downloadChapters(multiChapterComic, ['999001', '999002'])

      expect(ok).toBe(true)
      expect(hcomic.download).toHaveBeenCalledWith('999001', multiChapterComic, undefined, ['999001', '999002'])
    })

    it('handles single taskId responses too', async () => {
      const hcomic = createMockHcomic({
        download: vi.fn().mockResolvedValue({ taskId: 't-only', status: 'queued' }),
      })

      const { result } = renderHook(() => useDownloadHelper())
      const ok = await result.current.downloadChapters(multiChapterComic, ['999001'])

      expect(ok).toBe(true)
      expect(hcomic.download).toHaveBeenCalledWith('999001', multiChapterComic, undefined, ['999001'])
    })

    it('returns false when download throws', async () => {
      createMockHcomic({
        download: vi.fn().mockRejectedValue(new Error('boom')),
      })

      const { result } = renderHook(() => useDownloadHelper())
      const ok = await result.current.downloadChapters(multiChapterComic, ['999001'])

      expect(ok).toBe(false)
    })
  })
})
