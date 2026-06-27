/**
 * 空闲调度工具。
 *
 * 封装 `requestIdleCallback`，为非紧急任务（如懒加载 chunk 预热）提供低优先级调度。
 * Chromium renderer 原生支持 `requestIdleCallback`；测试环境（jsdom）通过 `tests/setup.ts`
 * 的全局 mock 提供；本模块在不支持时自动降级为 `setTimeout(fn, 0)`，保证跨环境可用。
 *
 * 可测试性约定：测试用 vitest fake timers + jsdom mock 驱动，详见 scheduler.test.ts。
 */

/** requestIdleCallback 的回调参数形状（浏览器原生 IdleDeadline）。 */
interface IdleDeadline {
  readonly didTimeout: boolean
  timeRemaining(): number
}

/** scheduleIdle 返回的 cancel 句柄，用于撤销尚未触发的调度。 */
export interface IdleHandle {
  /** 撤销调度。若回调已触发则为空操作。 */
  cancel(): void
}

type RequestIdleCallback = (cb: (deadline: IdleDeadline) => void, options?: { timeout: number }) => number
type CancelIdleCallback = (handle: number) => void

/**
 * 是否原生支持 requestIdleCallback。
 * 单独抽成函数便于测试 mock。
 */
function getNativeIdle(): { request: RequestIdleCallback | null; cancel: CancelIdleCallback | null } {
  if (typeof window === 'undefined') return { request: null, cancel: null }
  const request = (window as unknown as { requestIdleCallback?: RequestIdleCallback }).requestIdleCallback
  const cancel = (window as unknown as { cancelIdleCallback?: CancelIdleCallback }).cancelIdleCallback
  return { request: request ?? null, cancel: cancel ?? null }
}

/**
 * 在浏览器空闲时调度一个任务。
 *
 * 优先用 `requestIdleCallback`（低优先级，不抢占主线程）；
 * 不支持时降级为 `setTimeout(task, 0)`（宏任务，至少让出当前同步执行栈）。
 *
 * @param task 要在空闲期执行的任务
 * @param timeout 超时（ms）。传入时，即使主线程持续繁忙，也最迟在此时间后强制执行。
 *               仅对原生 requestIdleCallback 生效（降级路径忽略此参数）。
 * @returns cancel 句柄，调用其 `cancel()` 可撤销调度
 */
export function scheduleIdle(task: () => void, timeout?: number): IdleHandle {
  const { request, cancel } = getNativeIdle()

  if (request && cancel) {
    let cancelled = false
    // 包一层 wrapper 检查 cancelled：即使底层 cancelIdleCallback 因环境差异（如
    // 测试 fake timers 的句柄映射）未能阻止回调，也能在回调执行前拦截。
    const handle = request(() => {
      if (cancelled) return
      task()
    }, timeout ? { timeout } : undefined)
    return {
      cancel() {
        if (cancelled) return
        cancelled = true
        cancel(handle)
      },
    }
  }

  // 降级路径：不支持 requestIdleCallback（如 jsdom 未 mock 时）走 setTimeout
  const timer = window.setTimeout(task, 0)
  let cancelled = false
  return {
    cancel() {
      if (cancelled) return
      cancelled = true
      window.clearTimeout(timer)
    },
  }
}
