import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFlipPace, computeAdaptiveParams, buildPreloadQueue } from './adaptive-preload'

/**
 * Compute contiguous 1-based page ranges from a set of 0-based cache indices.
 *
 * Returns `{ start, end }` pairs where both are **1-based inclusive** page
 * numbers suitable for rendering on the progress bar.  `total` is the total
 * page count (1-based), used to clamp `end`.
 *
 * Example: cache indices [0, 1, 2, 5, 6] with total=10 →
 *   [{ start: 1, end: 3 }, { start: 6, end: 7 }]
 */
function computeContiguousRanges(
  indices: number[],
  total: number,
): { start: number; end: number }[] {
  if (indices.length === 0) return []
  const sorted = [...indices].sort((a, b) => a - b)
  const ranges: { start: number; end: number }[] = []
  let rangeStart = sorted[0]
  let rangeEnd = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === rangeEnd + 1) {
      rangeEnd = sorted[i]
    } else {
      ranges.push({
        start: rangeStart + 1,
        end: Math.min(rangeEnd + 1, total),
      })
      rangeStart = sorted[i]
      rangeEnd = sorted[i]
    }
  }
  ranges.push({
    start: rangeStart + 1,
    end: Math.min(rangeEnd + 1, total),
  })
  return ranges
}

function recomputeRanges(
  cache: Map<number, string>,
  total: number,
): { start: number; end: number }[] {
  const indices: number[] = []
  cache.forEach((_, idx) => indices.push(idx))
  return computeContiguousRanges(indices, total)
}

/**
 * Manages concurrent preloading of reader page images around a jump target.
 * Uses a worker-pool pattern to fetch multiple pages in parallel.
 *
 * 可选 adaptive 参数开启自适应预加载：按近期翻页间隔动态放大 forward 并在极快时
 * 启用远近交替队列。关闭时（默认）行为与改造前逐字节一致。
 */
export function usePreloadManager(
  imageUrls: string[],
  loadingState: string,
  scrambleId?: string,
  comicId?: string,
  imageQuality?: string,
  forward = 8,
  backward = 2,
  concurrency = 3,
  adaptive?: { enabled: boolean },
) {
  const imageCacheRef = useRef(new Map<number, string>())
  const [cacheVersion, setCacheVersion] = useState(0)
  const [preloadedRanges, setPreloadedRanges] = useState<
    { start: number; end: number }[]
  >([])
  const [preloadTarget, setPreloadTarget] = useState<number | null>(null)
  // 预加载优先级代数：每次 preloadTarget 切换（effect 重启）+1，随
  // fetchPreviewImage 携带到后端。后端 worker 取出任务时若 generation <
  // cancelled_floor 则跳过（reader-jump-preload-priority 规范），使进度条
  // 跳转后的目标页请求不被旧 target 残留请求堵在后端 FIFO 队列后面。
  // 用 ref 持有当前代，worker 闭包读 ref 取最新值（避免进入依赖数组抖动）。
  const generationRef = useRef(0)

  // useFlipPace 始终运行（开销极小）；adaptive 关闭时其输出被忽略
  const { effectiveInterval, isFlippingFast, reset: resetPace } = useFlipPace(preloadTarget ?? -1)

  const clearCache = useCallback(() => {
    imageCacheRef.current.clear()
    setCacheVersion(0)
    setPreloadedRanges([])
    setPreloadTarget(null)
    // 换章/关闭 modal 时同步重置 generation 并通知后端丢弃 generation=0
    // 的初始批次排队请求（若有）。失败静默：旧后端无此 IPC 时不阻塞清理。
    generationRef.current = 0
    window.hcomic?.cancelPreviewGenerations?.(1)?.catch?.(() => {})
    resetPace() // 同步清空翻页节奏样本，避免残留间隔影响新漫画/章节的初始判定
  }, [resetPace])

  // 换章或解码参数变化时清空共享缓存：imageCacheRef 以页码 index 为键，其内容绑定
  // 具体章节的图片集合。新章节的 imageUrls/comicId/scrambleId/imageQuality 变化时必须清空，
  // 禁止跨章复用 urlHash（reader-chapter-cache-invalidation spec）——否则换章后当前页及
  // 相邻页会命中上一章同 index 的 urlHash，而消费者（ReaderPage/FlipPage）命中即采用、
  // 跳过 IPC 重取，导致渲染上一章图片。清空由 hook 自管，调用方（ComicReaderModal 换章路径）
  // 零知识。与 modal 关闭分支的 clearCache() 互不冲突（关闭时输入亦变 → 幂等）。
  // 此处是"输入变化即重置派生状态"的合法模式（与 StorageStatsPanel/ComicInfoDrawer 同类），
  // clearCache 内含 setState，故按项目约定显式豁免 set-state-in-effect。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    clearCache()
  }, [imageUrls, comicId, scrambleId, imageQuality, clearCache])

  // 叶子组件（ReaderPage / FlipPage）取图成功后回写共享缓存的统一入口。
  // 去重：同索引同 urlHash 的写入跳过，避免命中分支或重复上报触发无谓重渲染。
  // 见 specs/reader-image-cache：覆盖懒加载 / 翻页 / 重试三条路径的写入契约。
  const markCached = useCallback((index: number, urlHash: string) => {
    if (imageCacheRef.current.get(index) === urlHash) return
    imageCacheRef.current.set(index, urlHash)
    setCacheVersion((v) => v + 1)
  }, [])

  // 计算动态参数（关闭自适应时恒为基线 + alternation:false，行为不变）
  const params = useMemo(() => {
    if (!adaptive?.enabled) {
      return { forward, concurrency, alternation: false }
    }
    const p = computeAdaptiveParams(effectiveInterval, { forward, concurrency })
    return { ...p, alternation: p.alternation && isFlippingFast }
  }, [adaptive?.enabled, effectiveInterval, isFlippingFast, forward, concurrency])

  // 把 params 快照收入 ref，使 effect 不必依赖 params 的细粒度字段——
  // alternation 在 FAST_MS 边界抖动时不再导致整个 worker pool 被拆解重建，
  // 已写入缓存的页有 cached 去重保护，下一轮自然会补齐差异。
  // ref 必须在 effect 内更新（而非 render 期），否则触发 react-hooks/refs 规则。
  // 注意：仅隔离高频抖动的 params；scrambleId/comicId/imageQuality/backward 是
  // 低频配置值，应留在依赖数组，变化时正常重启以采用新解码参数。
  const paramsRef = useRef(params)
  useEffect(() => {
    paramsRef.current = params
  }, [params])

  useEffect(() => {
    if (preloadTarget == null || loadingState !== 'loaded') return
    // 每次 target 切换重启 worker pool 时推进 generation：新批次的请求携带
    // 新代数，后端据此跳过旧代排队请求。同时通知后端推进 cancelled_floor，
    // 使仍排队的旧代请求在 worker 取出时被丢弃，把槽位让给本批目标页请求。
    // （reader-jump-preload-priority 规范）
    generationRef.current += 1
    const currentGeneration = generationRef.current
    window.hcomic?.cancelPreviewGenerations?.(currentGeneration)?.catch?.(() => {})
    let cancelled = false
    const cache = imageCacheRef.current
    // params 通过 ref 读取（避免 alternation 抖动重启）；
    // scrambleId/comicId/imageQuality/backward 直接引用闭包，变化时正常重启。
    const { forward, concurrency, alternation } = paramsRef.current

    const queue = buildPreloadQueue(
      preloadTarget,
      forward,
      backward,
      imageUrls.length,
      new Set(cache.keys()),
      alternation,
    )

    if (queue.length === 0) return

    const total = imageUrls.length
    const workerCount = Math.min(concurrency, queue.length)
    let pendingWrites = 0
    const workers: Promise<void>[] = []

    const flushBatch = () => {
      setCacheVersion((v) => v + 1)
      setPreloadedRanges(recomputeRanges(cache, total))
    }

    for (let i = 0; i < workerCount; i++) {
      workers.push(
        (async () => {
          while (queue.length > 0 && !cancelled) {
            const pg = queue.shift()!
            try {
              const result =
                await window.hcomic!.fetchPreviewImage(
                  imageUrls[pg - 1],
                  scrambleId,
                  comicId,
                  imageQuality,
                  currentGeneration,
                )
              if (cancelled) return
              if (result?.urlHash) {
                cache.set(pg - 1, result.urlHash)
                pendingWrites++
                if (pendingWrites >= 3) {
                  pendingWrites = 0
                  flushBatch()
                }
              }
            } catch {
              // Individual page preload failures are non-critical
            }
          }
        })(),
      )
    }

    Promise.all(workers).then(() => {
      if (!cancelled && pendingWrites > 0) {
        flushBatch()
      }
    })

    return () => {
      cancelled = true
    }
    // 依赖：target + 决定 URL 集合/解码参数的输入；params 通过 ref 读取，
    // 其变化（尤其 alternation 在 FAST_MS 边界抖动）不会重启 worker pool。
  }, [preloadTarget, loadingState, imageUrls, scrambleId, comicId, imageQuality, backward])

  return {
    imageCacheRef,
    cacheVersion,
    preloadedRanges,
    preloadTarget,
    setPreloadTarget,
    clearCache,
    markCached,
  }
}
