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

  // useFlipPace 始终运行（开销极小）；adaptive 关闭时其输出被忽略
  const { effectiveInterval, isFlippingFast, reset: resetPace } = useFlipPace(preloadTarget ?? -1)

  const clearCache = useCallback(() => {
    imageCacheRef.current.clear()
    setCacheVersion(0)
    setPreloadedRanges([])
    setPreloadTarget(null)
    resetPace() // 同步清空翻页节奏样本，避免残留间隔影响新漫画/章节的初始判定
  }, [resetPace])

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
  }
}
