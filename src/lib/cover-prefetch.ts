/**
 * 封面预加载工具。
 *
 * 在分页数据预加载 commit 之后、SFW 关闭时，对已缓存页的封面 URL 发起限并发预热。
 * 结果写入 useCoverImage 的模块级 coverOutcome memo，使后续 ComicCard 挂载时
 * useCoverImage 命中 memo 跳过 IPC，封面秒出。
 *
 * 设计要点（见 openspec/changes/prefetch-covers/design.md）：
 * - SFW 门控在工具入口：sfwMode=true 时直接返回，不发任何 IPC
 * - 限并发 2：cover pool 仅 4 worker，预载最多占一半，给可视页留 slot
 * - scheduleIdle 延迟启动：不在 commitPage 同步栈中立即发 IPC，让出主线程
 * - AbortSignal 中断：contextKey 切换时停止发起新请求；在途请求自然完成，
 *   结果仍写入 coverOutcome（以 URL 为 key，不因 contextKey 串扰，落盘封面是 LRU 合法条目）
 * - 复用 fetchCoverToMemo：与 useCoverImage 共享 memo + dedup，禁止独立缓存
 */
import type { ComicInfo } from '@shared/types'
import { fetchCoverToMemo } from '@/hooks/useCoverImage'
import { scheduleIdle } from './scheduler'

/** 封面预载的最大并发数。cover pool 共 4 worker，预载占 2，给可视页留 2。 */
const COVER_PREFETCH_CONCURRENCY = 2

export interface PrefetchCoversOptions {
  /** 数据预加载的 AbortSignal；contextKey 切换或卸载时 abort，预载停止发起新请求。 */
  signal: AbortSignal
  /** SFW 模式开关；true 时直接返回不发 IPC（封面不显示，预载纯浪费）。 */
  sfwMode: boolean
}

/**
 * 对已 commit 页的封面 URL 发起限并发预热。
 *
 * 从 comics[] 提取 coverUrl 去重，经 scheduleIdle 延迟后以并发 2 依次调用
 * fetchCoverToMemo（复用 useCoverImage 的 memo + dedup）。每次取下一个 URL 前
 * 检查 signal.aborted，中断则停止。
 *
 * @returns 用于测试的 promise：所有预载完成时 resolve（不论成败、是否中断）
 */
export function prefetchCovers(comics: ComicInfo[], options: PrefetchCoversOptions): Promise<void> {
  const { signal, sfwMode } = options

  // SFW 门控：封面不显示时预载纯浪费带宽与 cover pool 容量
  if (sfwMode) return Promise.resolve()

  // 提取 coverUrl 去重（保持顺序），过滤空值
  const urls: string[] = []
  const seen = new Set<string>()
  for (const comic of comics) {
    const url = comic.coverUrl
    if (url && !seen.has(url)) {
      seen.add(url)
      urls.push(url)
    }
  }
  if (urls.length === 0) return Promise.resolve()

  return new Promise<void>((resolve) => {
    // scheduleIdle 延迟启动：不在 commitPage 同步栈中立即发 IPC，让出主线程给可视页
    scheduleIdle(() => {
      void runWithConcurrency(urls, COVER_PREFETCH_CONCURRENCY, signal).finally(() => resolve())
    })
  })
}

/**
 * 限并发执行器：以 maxConcurrency 同时处理 urls，每个 URL 复用 fetchCoverToMemo。
 *
 * 每次从队列取下一个 URL 前检查 signal.aborted——中断则停止派发新任务，
 * 但已在途的请求自然完成（Python 线程池不可取消），结果写入 coverOutcome。
 */
async function runWithConcurrency(urls: string[], maxConcurrency: number, signal: AbortSignal): Promise<void> {
  let index = 0
  let active = 0

  await new Promise<void>((resolve) => {
    const dispatch = (): void => {
      // 终止条件：无在途任务，且（全部派发完毕 或 已中断不再派发）
      if (active === 0 && (index >= urls.length || signal.aborted)) {
        resolve()
        return
      }

      // 中断后停止派发新任务；在途任务完成后自然 resolve
      while (active < maxConcurrency && index < urls.length && !signal.aborted) {
        const url = urls[index++]
        active += 1
        // 复用 fetchCoverToMemo：命中 coverOutcome（含 null 失败标记）跳过 IPC，
        // 命中 pendingRequests 复用 in-flight promise，否则发新 IPC
        void fetchCoverToMemo(url).finally(() => {
          active -= 1
          dispatch()
        })
      }
    }
    dispatch()
  })
}
