import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDownload } from '@/hooks/useIpc'
import { mockWindowElectron, createMockIpcInvoke } from '../../__mocks__/ipc'
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
  })

  it('应返回 startDownload, cancelDownload, getDownloads', () => {
    mockWindowElectron()
    const { result } = renderHook(() => useDownload())
    expect(result.current.startDownload).toBeDefined()
    expect(result.current.cancelDownload).toBeDefined()
    expect(result.current.getDownloads).toBeDefined()
    expect(typeof result.current.startDownload).toBe('function')
    expect(typeof result.current.cancelDownload).toBe('function')
    expect(typeof result.current.getDownloads).toBe('function')
  })

  it('startDownload 应调用 python:download', async () => {
    const mockInvoke = createMockIpcInvoke({ 'python:download': { taskId: 't1' } })
    mockWindowElectron(mockInvoke)
    const { result } = renderHook(() => useDownload())
    const response = await result.current.startDownload('comic-1', mockComic)
    expect(mockInvoke).toHaveBeenCalledWith('python:download', 'comic-1', mockComic)
    expect(response).toEqual({ taskId: 't1' })
  })

  it('cancelDownload 应调用 python:cancel-download', async () => {
    const mockInvoke = createMockIpcInvoke({ 'python:cancel-download': { success: true } })
    mockWindowElectron(mockInvoke)
    const { result } = renderHook(() => useDownload())
    const response = await result.current.cancelDownload('task-1')
    expect(mockInvoke).toHaveBeenCalledWith('python:cancel-download', 'task-1')
    expect(response).toEqual({ success: true })
  })

  it('getDownloads 应调用 python:get-downloads', async () => {
    const tasks = [{ id: 't1', status: 'downloading' }]
    const mockInvoke = createMockIpcInvoke({ 'python:get-downloads': { tasks } })
    mockWindowElectron(mockInvoke)
    const { result } = renderHook(() => useDownload())
    const response = await result.current.getDownloads()
    expect(mockInvoke).toHaveBeenCalledWith('python:get-downloads')
    expect(response).toEqual({ tasks })
  })

  it('startDownload 应传递完整的 ComicInfo 数据', async () => {
    const comicWithExtras: ComicInfo = {
      ...mockComic,
      tags: ['action', 'adventure'],
      author: 'TestAuthor',
      pages: 50
    }
    const mockInvoke = createMockIpcInvoke({ 'python:download': { taskId: 't2' } })
    mockWindowElectron(mockInvoke)
    const { result } = renderHook(() => useDownload())
    await result.current.startDownload('comic-2', comicWithExtras)
    expect(mockInvoke).toHaveBeenCalledWith('python:download', 'comic-2', comicWithExtras)
  })
})
