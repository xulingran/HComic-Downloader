/// <reference types="vitest" />
import '@testing-library/jest-dom/vitest'

// requestIdleCallback / cancelIdleCallback 的 jsdom polyfill。
// jsdom 不实现 IdleScheduler，此处提供等价实现，让依赖 scheduleIdle 的代码
// 在测试中默认可用（配合 vitest fake timers 推进）。
//
// 实现说明：
// 1) 用自维护的 handle → timer 映射，cancel 走自己的映射清理，避免 vitest fake timers
//    在「requestIdleCallback 注册 / clearTimeout 清理」跨 API 时的句柄校验报错。
// 2) setTimeout/clearTimeout 通过 globalThis 动态查找（而非闭包捕获模块加载时的引用），
//    这样 vitest useFakeTimers() 接管后能正常推进/取消这些调度。
interface IdleDeadline {
  readonly didTimeout: boolean
  timeRemaining(): number
}
type RIC = (cb: (deadline: IdleDeadline) => void, opts?: { timeout: number }) => number
type CIC = (handle: number) => void

const NO_TIMEOUT_DEADLINE: IdleDeadline = {
  didTimeout: false,
  timeRemaining: () => 0,
}

if (typeof window !== 'undefined' && typeof window.requestIdleCallback !== 'function') {
  const handles = new Map<number, ReturnType<typeof setTimeout>>()
  let nextHandle = 1

  window.requestIdleCallback = ((cb: (deadline: IdleDeadline) => void) => {
    const handle = nextHandle++
    const timer = globalThis.setTimeout(() => {
      handles.delete(handle)
      cb(NO_TIMEOUT_DEADLINE)
    }, 0)
    handles.set(handle, timer)
    return handle
  }) as RIC

  window.cancelIdleCallback = ((handle: number) => {
    const timer = handles.get(handle)
    if (timer !== undefined) {
      globalThis.clearTimeout(timer)
      handles.delete(handle)
    }
  }) as CIC
}
