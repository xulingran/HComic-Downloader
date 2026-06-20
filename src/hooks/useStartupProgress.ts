import { useEffect, useState } from 'react'
import { useFatalErrorStore } from '../stores/useFatalErrorStore'

export interface StartupProgressState {
  /** 进度百分比 0-100，单调递增 */
  percent: number
  /** 当前阶段中文文案 */
  label: string
  /** 启动是否完成（percent>=100 或致命错误触发） */
  done: boolean
}

const INITIAL_STATE: StartupProgressState = {
  percent: 0,
  label: '正在启动应用…',
  done: false,
}

/**
 * 模块级缓存：存储订阅到的最新进度。
 *
 * 作用：React 挂载可能滞后于首个 STARTUP_PROGRESS IPC 事件
 * （Python 极快就绪时，事件可能在 createRoot().render() 之前到达）。
 * 订阅在模块加载时立即注册（不依赖 React 生命周期），事件到达即更新缓存；
 * hook 首次调用时读取缓存作为初始值，确保不丢失进度。
 *
 * 这与 index.html 的原生 JS 监听是双写关系：React 挂载前由 index.html 更新 DOM，
 * React 挂载后由本 hook 驱动 <StartupScreen>，两者读取同一事件源。
 */
let cachedPercent = INITIAL_STATE.percent
let cachedLabel = INITIAL_STATE.label
let subscribed = false
/**
 * 首屏就绪标志：由 markStartupReady() 设置。
 *
 * Python 进度最高只到 95%（"准备就绪"），最后的 95→100 由渲染进程触发——
 * 首个 IPC（getConfig）成功返回表示配置加载完成、真实首屏可安全渲染。
 * 此标志即代表那个"100%"，由 App 在 useInitConfig 完成后调用 markStartupReady 设置。
 */
let ready = false

const listeners = new Set<() => void>()

function notifyAll(): void {
  for (const listener of listeners) listener()
}

/**
 * 标记首屏就绪：由 App 在首个 IPC（getConfig）成功后调用。
 * 设置 ready 标志并广播，驱动 StartupScreen 淡出。
 */
export function markStartupReady(): void {
  if (ready) return
  ready = true
  notifyAll()
}

/**
 * 订阅启动进度 IPC 事件。
 *
 * 关键：在模块加载时立即调用（非 React useEffect 内），因为 Python 的 PROGRESS 事件
 * 可能在 React 挂载前就全部发完，若等到 useEffect 才订阅会错过所有事件导致进度卡在 0%。
 * 模块脚本在 did-finish-load 之前执行（HTML 解析完后、模块 defer 执行），
 * 配合 main 进程在 did-finish-load 重发缓存进度，能保证订阅就绪后接到重发事件。
 *
 * window.hcomic 通常在 hook 模块加载时已就绪（preload 先于页面脚本注入），
 * 但为防御边界情况，用轮询等待其就绪再订阅。
 */
function ensureSubscribed(): void {
  if (subscribed) return
  if (!window.hcomic?.onStartupProgress) {
    // window.hcomic 尚未就绪：轮询重试（preload 注入与模块加载的边界情况）
    setTimeout(ensureSubscribed, 50)
    return
  }
  subscribed = true
  window.hcomic.onStartupProgress((event) => {
    // 单调递增：新 percent 小于当前时忽略，防乱序回退
    if (event.percent < cachedPercent) return
    cachedPercent = event.percent
    cachedLabel = event.label
    notifyAll()
  })
}

// 模块加载时立即订阅：抢在 did-finish-load 重发之前注册好监听器。
// 这是修复"95%→0% 回退"根因的关键——订阅必须在 main 重发缓存值之前完成。
ensureSubscribed()

/**
 * 订阅启动进度，返回 { percent, label, done } 状态。
 *
 * 完成判定（done = true）由两个信号驱动：
 * 1. percent 达到 100（Python handler 注册完成 + 首屏就绪）
 * 2. useFatalErrorStore.error 非 null（Python 启动失败/重启超限，让位 FatalBanner）
 *
 * 任一触发即 done，App 据此淡出 <StartupScreen> 显示真实内容或 FatalBanner。
 */
export function useStartupProgress(): StartupProgressState {
  const fatalError = useFatalErrorStore((s) => s.error)
  const [state, setState] = useState<StartupProgressState>(() => ({
    percent: cachedPercent,
    label: cachedLabel,
    done: cachedPercent >= 100 || ready,
  }))

  useEffect(() => {
    const listener = () => {
      setState((prev) => {
        const nextDone = cachedPercent >= 100 || ready
        if (cachedPercent === prev.percent && cachedLabel === prev.label && nextDone === prev.done) {
          return prev
        }
        return {
          percent: cachedPercent,
          label: cachedLabel,
          done: nextDone,
        }
      })
    }
    listeners.add(listener)
    // 订阅后立即同步一次：捕获 useState 初始化后到 listener 注册之间的事件
    listener()
    return () => {
      listeners.delete(listener)
    }
  }, [])

  // 致命错误触发完成态：done 直接在 render 时由 fatalError 派生，
  // 避免 useEffect 内 setState（react-hooks/set-state-in-effect）。
  // fatalError 非 null 即让位 FatalBanner，App 据此淡出 StartupScreen。
  const done = state.done || fatalError !== null

  return { percent: state.percent, label: state.label, done }
}
