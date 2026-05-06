import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAuth } from '@/hooks/useIpc'
import { mockWindowElectron, createMockIpcInvoke } from '../../__mocks__/ipc'

describe('useAuth', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('应返回 applyAuth 和 verifyAuth 函数', () => {
    mockWindowElectron()
    const { result } = renderHook(() => useAuth())
    expect(result.current.applyAuth).toBeDefined()
    expect(result.current.verifyAuth).toBeDefined()
    expect(typeof result.current.applyAuth).toBe('function')
    expect(typeof result.current.verifyAuth).toBe('function')
  })

  it('applyAuth 应调用 python:apply-auth', async () => {
    const mockInvoke = createMockIpcInvoke({ 'python:apply-auth': { success: true } })
    mockWindowElectron(mockInvoke)
    const { result } = renderHook(() => useAuth())
    const response = await result.current.applyAuth('curl https://example.com')
    expect(mockInvoke).toHaveBeenCalledWith('python:apply-auth', 'curl https://example.com')
    expect(response).toEqual({ success: true })
  })

  it('verifyAuth 应调用 python:verify-auth', async () => {
    const mockInvoke = createMockIpcInvoke({ 'python:verify-auth': { valid: true } })
    mockWindowElectron(mockInvoke)
    const { result } = renderHook(() => useAuth())
    const response = await result.current.verifyAuth()
    expect(mockInvoke).toHaveBeenCalledWith('python:verify-auth')
    expect(response).toEqual({ valid: true })
  })

  it('applyAuth 应传递完整的 curl 命令文本', async () => {
    const curlCommand = `curl 'https://example.com/api' -H 'Cookie: session=abc123' -H 'User-Agent: Mozilla/5.0'`
    const mockInvoke = createMockIpcInvoke({ 'python:apply-auth': { success: true } })
    mockWindowElectron(mockInvoke)
    const { result } = renderHook(() => useAuth())
    await result.current.applyAuth(curlCommand)
    expect(mockInvoke).toHaveBeenCalledWith('python:apply-auth', curlCommand)
  })
})
