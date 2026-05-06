import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useConfig } from '@/hooks/useIpc'
import { mockWindowElectron, createMockIpcInvoke } from '../../__mocks__/ipc'

describe('useConfig', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('应返回 getConfig 和 setConfig 函数', () => {
    mockWindowElectron()
    const { result } = renderHook(() => useConfig())
    expect(result.current.getConfig).toBeDefined()
    expect(result.current.setConfig).toBeDefined()
    expect(typeof result.current.getConfig).toBe('function')
    expect(typeof result.current.setConfig).toBe('function')
  })

  it('getConfig 应调用 python:get-config', async () => {
    const config = { themeMode: 'dark' }
    const mockInvoke = createMockIpcInvoke({ 'python:get-config': config })
    mockWindowElectron(mockInvoke)
    const { result } = renderHook(() => useConfig())
    const response = await result.current.getConfig()
    expect(mockInvoke).toHaveBeenCalledWith('python:get-config')
    expect(response).toEqual(config)
  })

  it('setConfig 应调用 python:set-config', async () => {
    const mockInvoke = createMockIpcInvoke({ 'python:set-config': { success: true } })
    mockWindowElectron(mockInvoke)
    const { result } = renderHook(() => useConfig())
    const response = await result.current.setConfig('themeMode', 'dark')
    expect(mockInvoke).toHaveBeenCalledWith('python:set-config', 'themeMode', 'dark')
    expect(response).toEqual({ success: true })
  })

  it('setConfig 应支持不同的配置键和值类型', async () => {
    const mockInvoke = createMockIpcInvoke({ 'python:set-config': { success: true } })
    mockWindowElectron(mockInvoke)
    const { result } = renderHook(() => useConfig())
    await result.current.setConfig('concurrentDownloads', 5)
    expect(mockInvoke).toHaveBeenCalledWith('python:set-config', 'concurrentDownloads', 5)
  })
})
