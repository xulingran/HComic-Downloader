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
    expect(hcomic.applyAuth).toHaveBeenCalledWith('curl https://example.com')
    expect(response).toEqual({ success: true })
  })

  it('verifyAuth 应调用 window.hcomic.verifyAuth', async () => {
    const hcomic = createMockHcomic({ verifyAuth: vi.fn().mockResolvedValue({ valid: true, message: 'ok' }) })
    const { result } = renderHook(() => useAuth())
    const response = await result.current.verifyAuth()
    expect(hcomic.verifyAuth).toHaveBeenCalled()
    expect(response).toEqual({ valid: true, message: 'ok' })
  })

  it('applyAuth 应传递完整的 curl 命令文本', async () => {
    const curlCommand = `curl 'https://example.com/api' -H 'Cookie: session=abc123' -H 'User-Agent: Mozilla/5.0'`
    const hcomic = createMockHcomic({ applyAuth: vi.fn().mockResolvedValue({ success: true }) })
    const { result } = renderHook(() => useAuth())
    await result.current.applyAuth(curlCommand)
    expect(hcomic.applyAuth).toHaveBeenCalledWith(curlCommand)
  })
})
