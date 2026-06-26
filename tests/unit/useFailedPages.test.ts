import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFailedPages } from '@/hooks/useFailedPages'

describe('useFailedPages', () => {
  it('初始状态：failedCount=0, retryGen=0', () => {
    const { result } = renderHook(() => useFailedPages())
    expect(result.current.failedCount).toBe(0)
    expect(result.current.retryGen).toBe(0)
  })

  it('markFailed 增加失败计数', () => {
    const { result } = renderHook(() => useFailedPages())
    act(() => {
      result.current.markFailed(0)
      result.current.markFailed(1)
    })
    expect(result.current.failedCount).toBe(2)
  })

  it('重复 markFailed 同一索引幂等（不重复计数）', () => {
    const { result } = renderHook(() => useFailedPages())
    act(() => {
      result.current.markFailed(0)
      result.current.markFailed(0)
      result.current.markFailed(0)
    })
    expect(result.current.failedCount).toBe(1)
  })

  it('markLoaded 移除失败索引并递减计数', () => {
    const { result } = renderHook(() => useFailedPages())
    act(() => {
      result.current.markFailed(0)
      result.current.markFailed(1)
      result.current.markFailed(2)
    })
    act(() => { result.current.markLoaded(1) })
    expect(result.current.failedCount).toBe(2)
  })

  it('markLoaded 对未失败的索引无操作', () => {
    const { result } = renderHook(() => useFailedPages())
    act(() => {
      result.current.markFailed(0)
      result.current.markLoaded(5) // 未失败的索引
    })
    expect(result.current.failedCount).toBe(1)
  })

  it('retryAll 仅自增 retryGen，不动失败集合', () => {
    const { result } = renderHook(() => useFailedPages())
    act(() => {
      result.current.markFailed(0)
      result.current.markFailed(1)
    })
    const beforeRetry = result.current.retryGen

    act(() => { result.current.retryAll() })

    expect(result.current.retryGen).toBe(beforeRetry + 1)
    // 失败集合不动 —— 由叶子组件 effect 响应 retryGen 变化时自行清理
    expect(result.current.failedCount).toBe(2)
  })

  it('多次 retryAll 持续递增', () => {
    const { result } = renderHook(() => useFailedPages())
    act(() => { result.current.retryAll() })
    act(() => { result.current.retryAll() })
    act(() => { result.current.retryAll() })
    expect(result.current.retryGen).toBe(3)
  })

  it('clearAll 清空失败集合与 retryGen', () => {
    const { result } = renderHook(() => useFailedPages())
    act(() => {
      result.current.markFailed(0)
      result.current.markFailed(1)
      result.current.retryAll()
    })
    expect(result.current.failedCount).toBe(2)
    expect(result.current.retryGen).toBe(1)

    act(() => { result.current.clearAll() })
    expect(result.current.failedCount).toBe(0)
    expect(result.current.retryGen).toBe(0)
  })

  it('callbacks 身份稳定（多次 render 不变）', () => {
    const { result, rerender } = renderHook(() => useFailedPages())
    const { markFailed, markLoaded, retryAll, clearAll } = result.current
    rerender()
    expect(result.current.markFailed).toBe(markFailed)
    expect(result.current.markLoaded).toBe(markLoaded)
    expect(result.current.retryAll).toBe(retryAll)
    expect(result.current.clearAll).toBe(clearAll)
  })

  it('失败-恢复-再失败的完整生命周期', () => {
    const { result } = renderHook(() => useFailedPages())
    // 4 页失败（触发 >3 阈值）
    act(() => {
      result.current.markFailed(0)
      result.current.markFailed(1)
      result.current.markFailed(2)
      result.current.markFailed(3)
    })
    expect(result.current.failedCount).toBe(4)

    // 触发全部重试
    act(() => { result.current.retryAll() })

    // 模拟叶子组件逐个恢复（markLoaded）
    act(() => {
      result.current.markLoaded(0)
      result.current.markLoaded(1)
      result.current.markLoaded(2)
      result.current.markLoaded(3)
    })
    expect(result.current.failedCount).toBe(0)
  })
})
