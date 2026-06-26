import { useCallback, useRef, useState } from 'react'

/**
 * 阅读器层面的失败页聚合状态。
 *
 * 设计要点（见 openspec/changes/preview-retry-toast/design.md 决策 1/2/5）：
 * - 失败索引集合作为父组件级单一数据源；叶子组件通过 markFailed/markLoaded 上报
 * - retryAll 仅自增 retryGen，由叶子组件 effect 响应（仅重置当前 error 态的页）
 * - 阈值口径为"累计失败"，含用户接触过但已翻走的页（flip 模式未挂载的页天然不上报）
 *
 * 返回的 callbacks（markFailed/markLoaded/retryAll/clearAll）身份稳定，可安全作为
 * 叶子组件 effect 的依赖。
 */
export function useFailedPages() {
  // 用 ref 持有 Set 以保持回调身份稳定；用 failedCount 触发渲染
  const failedRef = useRef<Set<number>>(new Set())
  const [failedCount, setFailedCount] = useState(0)
  const [retryGen, setRetryGen] = useState(0)

  const markFailed = useCallback((idx: number) => {
    if (failedRef.current.has(idx)) return
    failedRef.current.add(idx)
    setFailedCount(failedRef.current.size)
  }, [])

  const markLoaded = useCallback((idx: number) => {
    if (!failedRef.current.has(idx)) return
    failedRef.current.delete(idx)
    setFailedCount(failedRef.current.size)
  }, [])

  /** 全部重试：自增 retryGen，叶子组件 effect 监听后重置 error 态重新加载 */
  const retryAll = useCallback(() => {
    setRetryGen((g) => g + 1)
  }, [])

  const clearAll = useCallback(() => {
    failedRef.current.clear()
    setFailedCount(0)
    setRetryGen(0)
  }, [])

  return {
    failedCount,
    retryGen,
    markFailed,
    markLoaded,
    retryAll,
    clearAll,
  }
}
