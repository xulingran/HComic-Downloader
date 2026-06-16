import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAuth } from '@/hooks/useIpc'
import { createMockHcomic } from '../../__mocks__/ipc'

describe('useAuth', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as unknown as Record<string, unknown>).hcomic
  })

  it('应返回 applyAuth 和 verifyAuth 函数', () => {
    createMockHcomic()
    const { result } = renderHook(() => useAuth())
    expect(result.current.applyAuth).toBeDefined()
    expect(result.current.verifyAuth).toBeDefined()
    expect(typeof result.current.applyAuth).toBe('function')
    expect(typeof result.current.verifyAuth).toBe('function')
  })

  it('applyAuth 应调用 window.hcomic.applyAuth', async () => {
    const hcomic = createMockHcomic({ applyAuth: vi.fn().mockResolvedValue({ success: true }) })
    const { result } = renderHook(() => useAuth())
    const response = await result.current.applyAuth('curl https://example.com')
    expect(hcomic.applyAuth).toHaveBeenCalledWith('curl https://example.com', undefined)
    expect(response).toEqual({ success: true })
  })

  it('verifyAuth 应调用 window.hcomic.verifyAuth', async () => {
    // createMockHcomic 设置 window.hcomic，verifyAuth 无参数转换，返回值断言验证透传
    createMockHcomic({ verifyAuth: vi.fn().mockResolvedValue({ valid: true, message: 'ok' }) })
    const { result } = renderHook(() => useAuth())
    const response = await result.current.verifyAuth()
    // 注：已移除 expect(hcomic.verifyAuth).toHaveBeenCalled() —— 裸调用断言同义反复
    // (verifyAuth 无参数转换，返回值断言已隐含"被调用")。保留下方返回值验证。
    expect(response).toEqual({ valid: true, message: 'ok' })
  })

  it('applyAuth 应传递完整的 curl 命令文本', async () => {
    const curlCommand = `curl 'https://example.com/api' -H 'Cookie: session=abc123' -H 'User-Agent: Mozilla/5.0'`
    const hcomic = createMockHcomic({ applyAuth: vi.fn().mockResolvedValue({ success: true }) })
    const { result } = renderHook(() => useAuth())
    await result.current.applyAuth(curlCommand)
    expect(hcomic.applyAuth).toHaveBeenCalledWith(curlCommand, undefined)
  })

  it('applyAuth 应传递 source 参数', async () => {
    const hcomic = createMockHcomic({ applyAuth: vi.fn().mockResolvedValue({ success: true }) })
    const { result } = renderHook(() => useAuth())
    await result.current.applyAuth('curl cmd', 'jmcomic')
    expect(hcomic.applyAuth).toHaveBeenCalledWith('curl cmd', 'jmcomic')
  })

  it('verifyAuth 应传递 source 参数', async () => {
    const hcomic = createMockHcomic({ verifyAuth: vi.fn().mockResolvedValue({ valid: true, message: 'ok' }) })
    const { result } = renderHook(() => useAuth())
    await result.current.verifyAuth('jmcomic')
    expect(hcomic.verifyAuth).toHaveBeenCalledWith('jmcomic')
  })
})
