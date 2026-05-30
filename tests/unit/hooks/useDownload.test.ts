import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDownload } from '@/hooks/useIpc'
import { createMockHcomic } from '../../__mocks__/ipc'
import type { ComicInfo } from '@shared/types'

const mockComic: ComicInfo = {
  id: 'comic-1',
  title: 'Test',
  url: 'https://example.com/1',
  coverUrl: 'https://example.com/cover.jpg',
  source: 'test'
}

describe('useDownload', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as unknown as Record<string, unknown>).hcomic
  })

  it('应返回 startDownload, cancelDownload, getDownloads', () => {
    createMockHcomic()
    const { result } = renderHook(() => useDownload())
    expect(result.current.startDownload).toBeDefined()
    expect(result.current.cancelDownload).toBeDefined()
    expect(result.current.getDownloads).toBeDefined()
    expect(typeof result.current.startDownload).toBe('function')
    expect(typeof result.current.cancelDownload).toBe('function')
    expect(typeof result.current.getDownloads).toBe('function')
  })

  it('startDownload 应调用 window.hcomic.download', async () => {
    const hcomic = createMockHcomic({ download: vi.fn().mockResolvedValue({ taskId: 't1', status: 'queued' }) })
    const { result } = renderHook(() => useDownload())
    const response = await result.current.startDownload('comic-1', mockComic)
    expect(hcomic.download).toHaveBeenCalledWith('comic-1', mockComic, undefined, undefined)
    expect(response).toEqual({ taskId: 't1', status: 'queued' })
  })

  it('cancelDownload 应调用 window.hcomic.cancelDownload', async () => {
    const hcomic = createMockHcomic({ cancelDownload: vi.fn().mockResolvedValue({ success: true }) })
    const { result } = renderHook(() => useDownload())
    const response = await result.current.cancelDownload('task-1')
    expect(hcomic.cancelDownload).toHaveBeenCalledWith('task-1')
    expect(response).toEqual({ success: true })
  })

  it('getDownloads 应调用 window.hcomic.getDownloads', async () => {
    const tasks = [{ id: 't1', status: 'downloading' }]
    const hcomic = createMockHcomic({ getDownloads: vi.fn().mockResolvedValue({ tasks }) })
    const { result } = renderHook(() => useDownload())
    const response = await result.current.getDownloads()
    expect(hcomic.getDownloads).toHaveBeenCalled()
    expect(response).toEqual({ tasks })
  })

  it('startDownload 应传递完整的 ComicInfo 数据', async () => {
    const comicWithExtras: ComicInfo = {
      ...mockComic,
      tags: ['action', 'adventure'],
      author: 'TestAuthor',
      pages: 50
    }
    const hcomic = createMockHcomic({ download: vi.fn().mockResolvedValue({ taskId: 't2', status: 'queued' }) })
    const { result } = renderHook(() => useDownload())
    await result.current.startDownload('comic-2', comicWithExtras)
    expect(hcomic.download).toHaveBeenCalledWith('comic-2', comicWithExtras, undefined, undefined)
  })
})
