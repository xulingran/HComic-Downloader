import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useIpc, useFavouriteTagsProgress, useTagListProgress } from '@/hooks/useIpc'
import { createMockHcomic } from '../../__mocks__/ipc'
import type { FavouriteTagsProgressEvent, TagListProgressEvent } from '@shared/types'

describe('useIpc', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as unknown as Record<string, unknown>).hcomic
  })

  it('应返回 invoke 函数', () => {
    createMockHcomic()
    const { result } = renderHook(() => useIpc())
    expect(result.current.invoke).toBeDefined()
    expect(typeof result.current.invoke).toBe('function')
  })

  it('应通过 window.hcomic 调用并返回结果', async () => {
    // createMockHcomic 设置 window.hcomic，invoke 透传后由返回值断言验证
    createMockHcomic({
      getConfig: vi.fn().mockResolvedValue({ config: { themeMode: 'dark' } }),
    })

    const { result } = renderHook(() => useIpc())
    const response = await result.current.invoke(() => window.hcomic!.getConfig())

    // 注：已移除 expect(hcomic.getConfig).toHaveBeenCalled() —— 裸调用断言同义反复
    // (invoke 透传 fn，返回值断言已隐含"fn 被执行")。
    // invoke 的核心行为（hcomic 不存在抛错、IPC 失败重抛）由后续用例覆盖。
    expect(response).toEqual({ config: { themeMode: 'dark' } })
  })

  it('当 hcomic API 不存在时应抛出错误', async () => {
    delete (window as unknown as Record<string, unknown>).hcomic

    const { result } = renderHook(() => useIpc())

    await expect(result.current.invoke(() => (window as unknown as Record<string, unknown>).hcomic?.getConfig?.())).rejects.toThrow(
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
    await expect(result.current.invoke(() => (window.hcomic as unknown as Record<string, () => unknown>).getConfig())).rejects.toThrow()
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

describe('useFavouriteTagsProgress', () => {
  // 可控订阅：捕获注册的 callback，测试可主动推送进度事件
  let subscribedCallback: ((data: FavouriteTagsProgressEvent) => void) | null = null
  const mockUnsubscribe = vi.fn()

  beforeEach(() => {
    subscribedCallback = null
    mockUnsubscribe.mockClear()
    delete (window as unknown as Record<string, unknown>).hcomic
    Object.defineProperty(window, 'hcomic', {
      value: {
        onFavouriteTagsProgress: vi.fn((cb: (data: FavouriteTagsProgressEvent) => void) => {
          subscribedCallback = cb
          return mockUnsubscribe
        }),
      },
      writable: true,
      configurable: true,
    })
  })

  it('切换来源时清空上一来源的残留进度，避免展示错误来源的错误帧', () => {
    // hcomic 同步报错后切到 jm，progress 必须被清空，不得保留 hcomic 的 error 帧
    const { result, rerender } = renderHook(({ source }) => useFavouriteTagsProgress(source), {
      initialProps: { source: 'hcomic' },
    })

    // 模拟后端推送 hcomic 的 error 进度
    act(() => {
      subscribedCallback!({ source: 'hcomic', phase: 'error', current: 0, total: 1, message: '未登录' })
    })
    expect(result.current.progress?.phase).toBe('error')
    expect(result.current.progress?.source).toBe('hcomic')

    // 切换到 jm：source 变化触发 effect 重跑，必须清空旧进度
    rerender({ source: 'jm' })

    // 关键不变量：切到 jm 后 progress 必须为 null，禁止残留 hcomic 的错误帧
    expect(result.current.progress).toBeNull()
  })

  it('仅接受匹配当前来源的进度事件', () => {
    const { result } = renderHook(() => useFavouriteTagsProgress('hcomic'))

    // 推送 jm 来源的事件，必须被忽略（不写入 hcomic 的 progress）
    act(() => {
      subscribedCallback!({ source: 'jm', phase: 'fetching', current: 1, total: 5 })
    })
    expect(result.current.progress).toBeNull()

    // 推送 hcomic 来源的事件，必须被接受
    act(() => {
      subscribedCallback!({ source: 'hcomic', phase: 'fetching', current: 2, total: 5 })
    })
    expect(result.current.progress?.source).toBe('hcomic')
    expect(result.current.progress?.current).toBe(2)
  })
})

describe('useTagListProgress', () => {
  // 可控订阅：捕获注册的 callback，测试可主动推送进度事件
  let subscribedCallback: ((data: TagListProgressEvent) => void) | null = null
  const mockUnsubscribe = vi.fn()

  beforeEach(() => {
    subscribedCallback = null
    mockUnsubscribe.mockClear()
    delete (window as unknown as Record<string, unknown>).hcomic
    Object.defineProperty(window, 'hcomic', {
      value: {
        onTagListProgress: vi.fn((cb: (data: TagListProgressEvent) => void) => {
          subscribedCallback = cb
          return mockUnsubscribe
        }),
      },
      writable: true,
      configurable: true,
    })
  })

  it('切换来源时清空上一来源的残留进度，避免展示错误来源的错误帧', () => {
    // hcomic 标签列表报错后切到 jm，progress 必须被清空，不得保留 hcomic 的 error 帧
    const { result, rerender } = renderHook(({ source }) => useTagListProgress(source), {
      initialProps: { source: 'hcomic' },
    })

    // 模拟后端推送 hcomic 的 error 进度
    act(() => {
      subscribedCallback!({
        source: 'hcomic',
        currentPage: 0,
        totalPages: 1,
        totalTags: 0,
        status: 'error',
        message: '请求超时',
      })
    })
    expect(result.current.progress?.status).toBe('error')
    expect(result.current.progress?.source).toBe('hcomic')

    // 切换到 jm：source 变化触发 effect 重跑，必须清空旧进度
    rerender({ source: 'jm' })

    // 关键不变量：切到 jm 后 progress 必须为 null，禁止残留 hcomic 的错误帧
    expect(result.current.progress).toBeNull()
  })

  it('仅接受匹配当前来源的进度事件', () => {
    const { result } = renderHook(() => useTagListProgress('hcomic'))

    // 推送 jm 来源的事件，必须被忽略（不写入 hcomic 的 progress）
    act(() => {
      subscribedCallback!({
        source: 'jm',
        currentPage: 1,
        totalPages: 5,
        totalTags: 10,
        status: 'running',
      })
    })
    expect(result.current.progress).toBeNull()

    // 推送 hcomic 来源的事件，必须被接受
    act(() => {
      subscribedCallback!({
        source: 'hcomic',
        currentPage: 2,
        totalPages: 5,
        totalTags: 8,
        status: 'running',
      })
    })
    expect(result.current.progress?.source).toBe('hcomic')
    expect(result.current.progress?.currentPage).toBe(2)
  })
})
