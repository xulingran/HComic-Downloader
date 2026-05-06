import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSearch } from '@/hooks/useIpc'
import { mockWindowElectron, createMockIpcInvoke } from '../../__mocks__/ipc'

describe('useSearch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('应返回 search 函数', () => {
    mockWindowElectron()
    const { result } = renderHook(() => useSearch())
    expect(result.current.search).toBeDefined()
    expect(typeof result.current.search).toBe('function')
  })

  it('应调用 python:search IPC channel', async () => {
    const searchResult = {
      comics: [{ id: '1', title: 'Comic', url: '', coverUrl: '', source: 'test' }],
      pagination: { currentPage: 1, totalPages: 1, totalItems: 1 }
    }
    const mockInvoke = createMockIpcInvoke({ 'python:search': searchResult })
    mockWindowElectron(mockInvoke)

    const { result } = renderHook(() => useSearch())
    const response = await result.current.search('test query', 'keyword', 1)

    expect(mockInvoke).toHaveBeenCalledWith('python:search', 'test query', 'keyword', 1, undefined)
    expect(response).toEqual(searchResult)
  })

  it('应支持翻页', async () => {
    const mockInvoke = createMockIpcInvoke({ 'python:search': {} })
    mockWindowElectron(mockInvoke)

    const { result } = renderHook(() => useSearch())
    await result.current.search('test', 'keyword', 3)

    expect(mockInvoke).toHaveBeenCalledWith('python:search', 'test', 'keyword', 3, undefined)
  })

  it('应传递空查询和不同的搜索模式', async () => {
    const mockInvoke = createMockIpcInvoke({ 'python:search': { comics: [], pagination: { currentPage: 1, totalPages: 0, totalItems: 0 } } })
    mockWindowElectron(mockInvoke)

    const { result } = renderHook(() => useSearch())
    await result.current.search('', 'tag', 1)

    expect(mockInvoke).toHaveBeenCalledWith('python:search', '', 'tag', 1, undefined)
  })
})
