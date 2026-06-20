import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createMockHcomic } from '../../__mocks__/ipc'

// 模块级缓存使得 hook 跨测试保留状态，每个测试前需重置模块
async function loadHook() {
  vi.resetModules()
  return await import('@/hooks/useStartupProgress')
}

describe('useStartupProgress', () => {
  let progressCallback: ((event: { percent: number; label: string }) => void) | null = null

  beforeEach(async () => {
    vi.restoreAllMocks()
    delete (window as unknown as Record<string, unknown>).hcomic
    progressCallback = null

    const hcomic = createMockHcomic()
    // 捕获订阅回调，测试可主动触发事件
    ;(hcomic.onStartupProgress as ReturnType<typeof vi.fn>).mockImplementation(
      (cb: (event: { percent: number; label: string }) => void) => {
        progressCallback = cb
        return () => { progressCallback = null }
      }
    )
  })

  it('初始状态应为 0% 且 done=false', async () => {
    const { useStartupProgress } = await loadHook()
    const { result } = renderHook(() => useStartupProgress())
    expect(result.current.percent).toBe(0)
    expect(result.current.done).toBe(false)
  })

  it('应接收并更新进度', async () => {
    const { useStartupProgress } = await loadHook()
    const { result } = renderHook(() => useStartupProgress())

    act(() => {
      progressCallback?.({ percent: 50, label: '下载引擎已就绪' })
    })

    expect(result.current.percent).toBe(50)
    expect(result.current.label).toBe('下载引擎已就绪')
    expect(result.current.done).toBe(false)
  })

  it('percent 达到 100 应标记 done=true', async () => {
    const { useStartupProgress } = await loadHook()
    const { result } = renderHook(() => useStartupProgress())

    act(() => {
      progressCallback?.({ percent: 100, label: '准备就绪' })
    })

    expect(result.current.percent).toBe(100)
    expect(result.current.done).toBe(true)
  })

  it('markStartupReady 应标记 done=true（首屏就绪信号，Python 进度仅到 95%）', async () => {
    const { useStartupProgress, markStartupReady } = await loadHook()
    const { result } = renderHook(() => useStartupProgress())

    // Python 进度到 95%（最高值）
    act(() => {
      progressCallback?.({ percent: 95, label: '准备就绪' })
    })
    expect(result.current.done).toBe(false)

    // 首屏就绪信号触发 done
    act(() => {
      markStartupReady()
    })

    expect(result.current.done).toBe(true)
  })

  it('markStartupReady 幂等：多次调用不重复广播', async () => {
    const { useStartupProgress, markStartupReady } = await loadHook()
    const { result } = renderHook(() => useStartupProgress())

    act(() => markStartupReady())
    expect(result.current.done).toBe(true)
    // 第二次不应抛错
    expect(() => act(() => markStartupReady())).not.toThrow()
    expect(result.current.done).toBe(true)
  })

  it('乱序 percent（小于当前）应被忽略', async () => {
    const { useStartupProgress } = await loadHook()
    const { result } = renderHook(() => useStartupProgress())

    act(() => {
      progressCallback?.({ percent: 50, label: '下载引擎已就绪' })
    })
    act(() => {
      progressCallback?.({ percent: 30, label: '不应回退' })
    })

    expect(result.current.percent).toBe(50)
    expect(result.current.label).toBe('下载引擎已就绪')
  })

  it('致命错误应触发 done=true（让位 FatalBanner）', async () => {
    const { useStartupProgress } = await loadHook()
    const { result } = renderHook(() => useStartupProgress())

    act(() => {
      progressCallback?.({ percent: 50, label: '下载引擎已就绪' })
    })
    expect(result.current.done).toBe(false)

    // 模拟 PythonBridge onFatal 触发 useFatalErrorStore.setError
    const { useFatalErrorStore } = await import('@/stores/useFatalErrorStore')
    act(() => {
      useFatalErrorStore.getState().setError({
        message: '后端服务异常',
        kind: 'backend-restart-exceeded',
      })
    })

    expect(result.current.done).toBe(true)
  })

  it('React 挂载滞后时不丢失进度（模块级缓存）', async () => {
    const { useStartupProgress } = await loadHook()

    // 模拟事件在 React 挂载前到达：先手动触发订阅
    // （hook 模块加载时不会自动订阅，需 ensureSubscribed 被调用）
    // 这里通过先 render 一次触发订阅，再卸载，再 render 模拟"滞后"
    const first = renderHook(() => useStartupProgress())
    act(() => {
      progressCallback?.({ percent: 75, label: '数据库已就绪' })
    })
    expect(first.result.current.percent).toBe(75)
    first.unmount()

    // 此时 progressCallback 仍可能被持有（unsubscribe 未执行或已执行），
    // 重新挂载 hook 应读到缓存的 75%
    const second = renderHook(() => useStartupProgress())
    expect(second.result.current.percent).toBe(75)
    expect(second.result.current.label).toBe('数据库已就绪')
  })
})
