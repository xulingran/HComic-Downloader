import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useIpc } from '@/hooks/useIpc'
import { mockWindowElectron, createMockIpcInvoke } from '../../__mocks__/ipc'

describe('useIpc', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('应返回 invoke 函数', () => {
    mockWindowElectron()
    const { result } = renderHook(() => useIpc())
    expect(result.current.invoke).toBeDefined()
    expect(typeof result.current.invoke).toBe('function')
  })

  it('应调用 ipcRenderer.invoke 并传递参数', async () => {
    const mockInvoke = createMockIpcInvoke({ 'python:get-config': { config: {} } })
    mockWindowElectron(mockInvoke)

    const { result } = renderHook(() => useIpc())
    const response = await result.current.invoke('python:get-config')

    expect(mockInvoke).toHaveBeenCalledWith('python:get-config')
    expect(response).toEqual({ config: {} })
  })

  it('当 electron API 不存在时应抛出错误', async () => {
    delete (window as any).electron

    const { result } = renderHook(() => useIpc())

    await expect(result.current.invoke('python:get-config' as any)).rejects.toThrow(
      'Electron IPC not available'
    )
  })

  it('当 ipcRenderer 不存在时应抛出错误', async () => {
    Object.defineProperty(window, 'electron', {
      value: {},
      writable: true,
      configurable: true
    })

    const { result } = renderHook(() => useIpc())

    await expect(result.current.invoke('python:get-config' as any)).rejects.toThrow(
      'Electron IPC not available'
    )
  })

  it('IPC 调用失败时应重新抛出错误', async () => {
    const mockInvoke = vi.fn().mockRejectedValue(new Error('IPC failed'))
    mockWindowElectron(mockInvoke)

    const { result } = renderHook(() => useIpc())

    await expect(result.current.invoke('python:get-config' as any)).rejects.toThrow('IPC failed')
  })

  it('应支持返回复杂对象', async () => {
    const complexResult = { data: [1, 2, 3], nested: { key: 'value' } }
    const mockInvoke = createMockIpcInvoke({ 'python:get-statistics': complexResult })
    mockWindowElectron(mockInvoke)

    const { result } = renderHook(() => useIpc())
    const response = await result.current.invoke('python:get-statistics')

    expect(response).toEqual(complexResult)
  })
})
