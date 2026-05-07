import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useConfig } from '@/hooks/useIpc'
import { createMockHcomic } from '../../__mocks__/ipc'

describe('useConfig', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as any).hcomic
  })

  it('应返回 getConfig 和 setConfig 函数', () => {
    createMockHcomic()
    const { result } = renderHook(() => useConfig())
    expect(result.current.getConfig).toBeDefined()
    expect(result.current.setConfig).toBeDefined()
    expect(typeof result.current.getConfig).toBe('function')
    expect(typeof result.current.setConfig).toBe('function')
  })

  it('getConfig 应调用 window.hcomic.getConfig', async () => {
    const config = { themeMode: 'dark' }
    const hcomic = createMockHcomic({ getConfig: vi.fn().mockResolvedValue(config) })
    const { result } = renderHook(() => useConfig())
    const response = await result.current.getConfig()
    expect(hcomic.getConfig).toHaveBeenCalled()
    expect(response).toEqual(config)
  })

  it('setConfig 应调用 window.hcomic.setConfig', async () => {
    const hcomic = createMockHcomic({ setConfig: vi.fn().mockResolvedValue({ success: true }) })
    const { result } = renderHook(() => useConfig())
    const response = await result.current.setConfig('themeMode', 'dark')
    expect(hcomic.setConfig).toHaveBeenCalledWith('themeMode', 'dark')
    expect(response).toEqual({ success: true })
  })

  it('setConfig 应支持不同的配置键和值类型', async () => {
    const hcomic = createMockHcomic({ setConfig: vi.fn().mockResolvedValue({ success: true }) })
    const { result } = renderHook(() => useConfig())
    await result.current.setConfig('concurrentDownloads', 5)
    expect(hcomic.setConfig).toHaveBeenCalledWith('concurrentDownloads', 5)
  })
})
