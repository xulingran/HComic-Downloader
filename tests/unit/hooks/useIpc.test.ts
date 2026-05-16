import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useIpc } from '@/hooks/useIpc'
import { createMockHcomic } from '../../__mocks__/ipc'

describe('useIpc', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as any).hcomic
  })

  it('应返回 invoke 函数', () => {
    createMockHcomic()
    const { result } = renderHook(() => useIpc())
    expect(result.current.invoke).toBeDefined()
    expect(typeof result.current.invoke).toBe('function')
  })

  it('应通过 window.hcomic 调用并返回结果', async () => {
    const hcomic = createMockHcomic({
      getConfig: vi.fn().mockResolvedValue({ config: { themeMode: 'dark' } }),
    })

    const { result } = renderHook(() => useIpc())
    const response = await result.current.invoke(() => window.hcomic!.getConfig())

    expect(hcomic.getConfig).toHaveBeenCalled()
    expect(response).toEqual({ config: { themeMode: 'dark' } })
  })

  it('当 hcomic API 不存在时应抛出错误', async () => {
    delete (window as any).hcomic

    const { result } = renderHook(() => useIpc())

    await expect(result.current.invoke(() => (window as any).hcomic?.getConfig?.())).rejects.toThrow(
      'Electron IPC not available'
    )
  })

  it('当 hcomic 为空对象时应抛出错误', async () => {
    Object.defineProperty(window, 'hcomic', {
      value: {},
      writable: true,
      configurable: true
    })

    const { result } = renderHook(() => useIpc())

    // hcomic exists but has no methods - the fn should throw
    await expect(result.current.invoke(() => (window.hcomic as any).getConfig())).rejects.toThrow()
  })

  it('IPC 调用失败时应重新抛出错误', async () => {
    createMockHcomic({
      getConfig: vi.fn().mockRejectedValue(new Error('IPC failed')),
    })

    const { result } = renderHook(() => useIpc())

    await expect(result.current.invoke(() => window.hcomic!.getConfig())).rejects.toThrow('IPC failed')
  })

  it('应支持返回复杂对象', async () => {
    const complexResult = { data: [1, 2, 3], nested: { key: 'value' } }
    createMockHcomic({
      getConfig: vi.fn().mockResolvedValue(complexResult),
    })

    const { result } = renderHook(() => useIpc())
    const response = await result.current.invoke(() => window.hcomic!.getConfig())

    expect(response).toEqual(complexResult)
  })
})
