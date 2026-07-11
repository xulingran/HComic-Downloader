import { useRef, useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { DisplayMode, BlankPosition } from '../hooks/useReaderSettings'
import { usePageFlipVariants } from '../lib/anim'
import { buildImageUrl } from '@/lib/image-url'
import { ReaderPagePlaceholder } from './common/ReaderPagePlaceholder'

/**
 * 根据当前页与上一页推断翻页方向。
 *
 * 抽出为纯函数便于单测：direction 推断必须在渲染期间同步完成（adjust state while
 * rendering），否则 AnimatePresence 在首次提交会拿到 stale direction，导致"先下一页、
 * 再上一页"等回退场景的退出页朝错误方向飞出。
 *
 * @returns 'forward' | 'backward'；两页相等时返回 null（无方向变化）。
 */
export function inferPageDirection(current: number, previous: number): 'forward' | 'backward' | null {
  if (current === previous) return null
  return current > previous ? 'forward' : 'backward'
}

/**
 * isFlipping 兜底解锁硬上限（毫秒）。
 *
 * 翻页过渡用 smoothTransition（DURATION.slow=300ms）。正常路径下 framer-motion 的
 * onAnimationComplete 会在动画结束（~300ms）时把 isFlipping 置回 false；但若某次
 * currentPage 变更没有真正播动画（图仍在加载、AnimatePresence 重挂载、reduced-motion
 * 跳过等），onAnimationComplete 不触发，isFlipping 永久停在 true，滚轮/拖拽被吞掉。
 * 兜底定时器到点强制解锁，取 600ms（2 倍裕量覆盖真实抖动）作为硬上限——即便回调丢失，
 * 锁最多持续 600ms 后自愈。详见上锁 effect 的注释。
 */
const FLIP_LOCK_TIMEOUT = 600

interface PageFlipViewProps {
  imageUrls: string[]
  totalPages: number
  currentPage: number
  setCurrentPage: (page: number) => void
  displayMode: DisplayMode
  imageWidth: number
  zoom: number
  imageCacheRef: React.RefObject<Map<number, string>>
  cacheVersion: number
  onPageChange: (page: number) => void
  blankPosition: BlankPosition
  scrambleId?: string
  comicId?: string
  imageQuality?: string
  /** 加载失败时上报（透传给内部 FlipPage） */
  onFailed?: (index: number) => void
  /** 加载成功时上报 */
  onLoaded?: (index: number) => void
  /** 取图成功后回写共享缓存（透传给内部 FlipPage，见 specs/reader-image-cache） */
  onCached?: (index: number, urlHash: string) => void
  /** 父级"全部重试"代数；变化时若当前 FlipPage 处于 error 态则重置触发重载 */
  retryGen?: number
  /** Optional local/custom image loader. Returns a final browser-readable URL. */
  imageLoader?: (url: string, index: number) => Promise<string>
}

export function PageFlipView({
  imageUrls,
  totalPages,
  currentPage,
  setCurrentPage,
  displayMode,
  imageWidth,
  zoom,
  imageCacheRef,
  cacheVersion,
  onPageChange,
  blankPosition,
  scrambleId,
  comicId,
  imageQuality,
  onFailed,
  onLoaded,
  onCached,
  retryGen,
  imageLoader,
}: PageFlipViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [panOffset, setPanOffset] = useState(0)
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, offset: 0 })

  // 变更 3：翻页方向感知 + isFlipping 门控。
  // 4 个翻页触发路径（键盘/点击/wheel/滑块）都最终走 setCurrentPage，
  // 此处统一在渲染期间推断 direction，无需改外部接口。
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward')
  // 关键修复：direction 必须在渲染期间同步推断（React 的 "adjust state while
  // rendering" 模式）。原实现把 setDirection 放进 useEffect，导致 currentPage 变化
  // 触发的首次提交里 AnimatePresence 仍带着"旧 direction"启动退出页动画——
  // 典型表现为"先下一页、再上一页"时旧页依旧向左飞出（应为向右）。
  // 现在用 state 保存上一页，渲染期间对比 currentPage 与 prevPage 同步 setDirection +
  // setPrevPage。React 检测到 state 变化会丢弃当前渲染输出并立即用新值重渲染，
  // AnimatePresence 的 custom 因此在同一提交里就与 key 一致；值稳定后自动退出。
  const [prevPage, setPrevPage] = useState(currentPage)
  const [isFlipping, setIsFlipping] = useState(false)
  // 标记组件是否已完成首次挂载。用于让"currentPage 变化即上锁"的 effect 跳过
  // 首次执行——AnimatePresence initial={false} 首次挂载不播动画、不触发
  // onAnimationComplete，首次若上锁将永久锁死 isFlipping。详见下面该 effect。
  const hasMountedRef = useRef(false)
  // 安全网：上锁 effect 与 framer-motion onAnimationComplete 解锁源可能失步——
  // fetchUrls / 历史续读 / 模式切换等异步路径在首次挂载后改 currentPage，若该次
  // 变更没有真正播动画（图仍在加载、AnimatePresence 重挂载、reduced-motion 等），
  // onAnimationComplete 不触发，isFlipping 永久停在 true，滚轮/拖拽被永久吞掉。
  // 兜底：上锁时启动一个不超过最大动画时长的定时器强制解锁；正常 onAnimationComplete
  // 提前解锁则清掉定时器。翻页过渡用 smoothTransition（DURATION.slow=300ms），取
  // 600ms（2 倍裕量覆盖真实抖动）作为硬上限——任何"卡死"最多持续 600ms 后自愈。
  const flipLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isDoubleMode = displayMode === 'double'
  const step = isDoubleMode ? 2 : 1

  const effectiveTotal = isDoubleMode && blankPosition === 'front' ? totalPages + 1 : totalPages

  const canGoPrev = currentPage > 1
  const canGoNext = isDoubleMode
    ? currentPage + step <= effectiveTotal
    : currentPage < effectiveTotal

  const pageVariants = usePageFlipVariants()

  const goNext = useCallback(() => {
    if (!canGoNext) return
    const next = Math.min(currentPage + step, effectiveTotal)
    setCurrentPage(next)
    setPanOffset(0)
  }, [canGoNext, currentPage, step, effectiveTotal, setCurrentPage])

  const goPrev = useCallback(() => {
    if (!canGoPrev) return
    const prev = Math.max(currentPage - step, 1)
    setCurrentPage(prev)
    setPanOffset(0)
  }, [canGoPrev, currentPage, step, setCurrentPage])

  const clampPanOffset = useCallback((offset: number) => {
    const container = containerRef.current
    if (!container) return offset
    const visualWidth = container.scrollWidth * zoom
    const panRange = Math.max(0, (visualWidth - container.offsetWidth) / 2)
    return Math.max(-panRange, Math.min(panRange, offset))
  }, [zoom])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (isFlipping) return // 翻页动画中忽略拖拽
    isPanning.current = true
    panStart.current = { x: e.clientX, offset: panOffset }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }, [panOffset, isFlipping])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning.current) return
    const dx = e.clientX - panStart.current.x
    const newOffset = panStart.current.offset + dx
    setPanOffset(clampPanOffset(newOffset))
  }, [clampPanOffset])

  const handlePointerUp = useCallback(() => {
    isPanning.current = false
  }, [])

  // 变更 3：wheel 节流改为 isFlipping 门控——动画完成才响应下一次 wheel，
  // 避免固定 200ms 节流导致 AnimatePresence 内页面层堆积。
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (isFlipping) return
    if (e.deltaY > 0) goNext()
    else if (e.deltaY < 0) goPrev()
  }, [goNext, goPrev, isFlipping])

  // 翻页方向推断：必须在渲染期间同步 setDirection（adjust-state-while-rendering）。
  // useEffect 内 set 会让 AnimatePresence 在首次提交时拿到 stale direction，
  // 导致"下一页→上一页"等回退场景的退出页朝错误方向飞出。
  // prevPage 是 state：渲染期间比较两个 state 安全；调用 setDirection/setPrevPage 后
  // React 丢弃本次渲染输出并立即以新 state 重渲染，AnimatePresence 的 custom 因此
  // 在同一提交里就与 key 一致。prevPage 稳定后条件为假，自动退出，无无限循环。
  if (currentPage !== prevPage) {
    const inferred = inferPageDirection(currentPage, prevPage)
    if (inferred) setDirection(inferred)
    setPrevPage(currentPage)
  }

  // onPageChange 仍需在每次翻页后触发预加载。上面渲染期间已把 prevPage 追平，
  // 这里用独立 ref 记录"上次已触发 onPageChange 的页码"，仅作 effect 内提交判断，
  // 不参与渲染输入，因此读取安全（eslint react-hooks/refs 通过）。
  // 首次挂载也触发一次（与原 isFirstRender 语义一致），让预加载器拿到初始页。
  const lastNotifiedPageRef = useRef<number | null>(null)
  useEffect(() => {
    if (currentPage !== lastNotifiedPageRef.current) {
      lastNotifiedPageRef.current = currentPage
      onPageChange(currentPage)
    }
  }, [currentPage, onPageChange])

  let leftRealIdx: number
  let rightRealIdx: number | null
  let leftIsBlank = false
  let rightIsBlank = false

  if (isDoubleMode && blankPosition === 'front') {
    leftRealIdx = currentPage - 2
    rightRealIdx = currentPage - 1
    leftIsBlank = leftRealIdx < 0
    rightIsBlank = rightRealIdx >= totalPages
  } else if (isDoubleMode && blankPosition === 'end') {
    leftRealIdx = currentPage - 1
    rightRealIdx = currentPage < totalPages ? currentPage : null
    rightIsBlank = rightRealIdx === null
  } else {
    leftRealIdx = currentPage - 1
    rightRealIdx = isDoubleMode && currentPage < totalPages ? currentPage : null
  }

  // cacheVersion triggers re-render to pick up newly preloaded images from imageCacheRef
  void cacheVersion

  // Clamp panOffset when zoom changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPanOffset(prev => clampPanOffset(prev))
  }, [clampPanOffset])

  const handleAnimationComplete = useCallback(() => {
    setIsFlipping(false)
    if (flipLockTimerRef.current) {
      clearTimeout(flipLockTimerRef.current)
      flipLockTimerRef.current = null
    }
  }, [])

  // 组件卸载时清掉兜底定时器，避免卸载后仍 setState。
  useEffect(() => {
    return () => {
      if (flipLockTimerRef.current) clearTimeout(flipLockTimerRef.current)
    }
  }, [])

  // currentPage 变化即触发翻页动画，置 isFlipping=true。
  // 关键：必须跳过首次挂载。framer-motion v12 的 AnimatePresence initial={false}
  // 在子组件首次挂载时跳过 enter→center 动画——animateChanges() 检测到
  // isInitialRender && props.initial === false，强制 shouldAnimate=false，返回
  // Promise.resolve() 而不调用 animate()，因此 onAnimationComplete 永不触发。
  // 若首次挂载也上锁，解锁回调不来，isFlipping 永久停在 true，滚轮/拖拽平移/
  // pointerEvents 全部失效。跳过首次挂载让上锁源(effect)与解锁源(动画完成回调)
  // 在首次挂载时都"不动作"，状态机恢复对称。
  //
  // 但跳过首次挂载只挡得住"首帧"。父级 ComicReaderModal 在 fetchUrls / 历史续读 /
  // 模式切换等异步路径里改 currentPage，此时首帧已过、hasMountedRef 为 true，
  // effect 会正常上锁；若该次变更没有真正播动画，onAnimationComplete 不触发，
  // isFlipping 永久停在 true（滚轮/拖拽失效，只有点击边缘按钮能间接触发一次真动画
  // 解锁——即"必须先点按钮才能滚轮"的 bug）。兜底：上锁同时启动 FLIP_LOCK_TIMEOUT
  // 定时器，到点强制解锁；正常 onAnimationComplete 提前解锁时清掉它。
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true
      return // 首次挂载：无动画可等，不上锁
    }
    setIsFlipping(true)
    if (flipLockTimerRef.current) clearTimeout(flipLockTimerRef.current)
    flipLockTimerRef.current = setTimeout(() => {
      flipLockTimerRef.current = null
      setIsFlipping(false)
    }, FLIP_LOCK_TIMEOUT)
  }, [currentPage])

  const renderPageContent = () => {
    if (isDoubleMode) {
      // double 模式：左右两页 + 可能的空白页用同一 motion.div 包裹，整体滑动
      return (
        <div className="h-full flex items-center justify-center" style={{ gap: '4px' }}>
          <div className="h-full flex items-center justify-center">
            {leftIsBlank ? <BlankPage /> : (
              <FlipPage url={imageUrls[leftRealIdx]} index={leftRealIdx} cachedUrlHash={imageCacheRef.current?.get(leftRealIdx)} scrambleId={scrambleId} comicId={comicId} imageQuality={imageQuality} onFailed={onFailed} onLoaded={onLoaded} onCached={onCached} retryGen={retryGen} imageLoader={imageLoader} />
            )}
          </div>
          {(rightRealIdx !== null || rightIsBlank) && (
            <div className="h-full flex items-center justify-center">
              {rightIsBlank ? <BlankPage /> : (
                <FlipPage url={imageUrls[rightRealIdx!]} index={rightRealIdx!} cachedUrlHash={imageCacheRef.current?.get(rightRealIdx!)} scrambleId={scrambleId} comicId={comicId} imageQuality={imageQuality} onFailed={onFailed} onLoaded={onLoaded} onCached={onCached} retryGen={retryGen} imageLoader={imageLoader} />
              )}
            </div>
          )}
        </div>
      )
    }
    // single 模式
    return (
      <div className="h-full flex items-center justify-center">
        <FlipPage url={imageUrls[leftRealIdx]} index={leftRealIdx} cachedUrlHash={imageCacheRef.current?.get(leftRealIdx)} scrambleId={scrambleId} comicId={comicId} imageQuality={imageQuality} onFailed={onFailed} onLoaded={onLoaded} onCached={onCached} retryGen={retryGen} imageLoader={imageLoader} />
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-hidden relative flex items-center justify-center"
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div
        className="flex items-center justify-center h-full"
        style={{
          width: `${imageWidth}%`,
          transform: `translateX(${panOffset}px) scale(${zoom})`,
          transition: isPanning.current ? 'none' : undefined, // eslint-disable-line react-hooks/refs
        }}
      >
        {/* 翻页过渡：AnimatePresence + mode="popLayout" 让新旧页过渡期间同时存在。
            initial={false} 避免首次进入也播动画。
            key={currentPage} 让每次翻页触发 exit/enter。
            custom={direction} 把方向传给 variants 函数。 */}
        <AnimatePresence custom={direction} mode="popLayout" initial={false}>
          <motion.div
            key={currentPage}
            variants={pageVariants}
            custom={direction}
            initial="enter"
            animate="center"
            exit="exit"
            onAnimationComplete={handleAnimationComplete}
            className="h-full flex items-center justify-center"
            style={{ pointerEvents: isFlipping ? 'none' : undefined, willChange: isFlipping ? 'transform' : undefined }}
          >
            {/* renderPageContent 读取 imageCacheRef.current 取预加载图，属原模式 */}
            {/* eslint-disable-next-line react-hooks/refs */}
            {renderPageContent()}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Click-to-flip overlay：左右边缘条带（各 ~20%）+ 中央拖拽安全区（~60%）。
          安全区 pointer-events-none 让指针事件穿透到容器的拖拽平移 / 滚轮 handler；
          边缘按钮保留 stopPropagation 以独占"翻页点击"语义。详见 shrink-pageflip-trigger-zones design.md。 */}
      <div className="absolute inset-0 flex pointer-events-none">
        <button
          aria-label="上一页"
          aria-disabled={!canGoPrev}
          className="w-1/5 h-full pointer-events-auto cursor-pointer flex items-center justify-start pl-4 group"
          onClick={goPrev}
          onPointerDown={(e) => e.stopPropagation()}
          style={{ background: 'transparent', border: 'none' }}
        >
          <svg
            width="32" height="32" viewBox="0 0 32 32" fill="none"
            className="opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            style={{ color: 'rgba(255,255,255,0.5)' }}
          >
            <path d="M20 8l-8 8 8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {/* 中央拖拽安全区：flex-1 (~60%) + pointer-events-none。
            显式留白，使该区域 pointer 事件冒泡到容器 handlePointerDown（zoom>1 平移）。 */}
        <div className="flex-1 h-full pointer-events-none" data-testid="flip-drag-safe-zone" />
        <button
          aria-label="下一页"
          aria-disabled={!canGoNext}
          className="w-1/5 h-full pointer-events-auto cursor-pointer flex items-center justify-end pr-4 group"
          onClick={goNext}
          onPointerDown={(e) => e.stopPropagation()}
          style={{ background: 'transparent', border: 'none' }}
        >
          <svg
            width="32" height="32" viewBox="0 0 32 32" fill="none"
            className="opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            style={{ color: 'rgba(255,255,255,0.5)' }}
          >
            <path d="M12 8l8 8-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}

function BlankPage() {
  return (
    <div
      className="h-full flex items-center justify-center"
      style={{
        aspectRatio: '3/4',
        border: '2px dashed rgba(255,255,255,0.15)',
        borderRadius: '4px',
        background: 'rgba(255,255,255,0.03)',
      }}
    />
  )
}

function FlipPage({ url, index, cachedUrlHash, scrambleId, comicId, imageQuality, onFailed, onLoaded, onCached, retryGen, imageLoader }: { url: string; index: number; cachedUrlHash?: string; scrambleId?: string; comicId?: string; imageQuality?: string; onFailed?: (index: number) => void; onLoaded?: (index: number) => void; onCached?: (index: number, urlHash: string) => void; retryGen?: number; imageLoader?: (url: string, index: number) => Promise<string> }) {
  const [urlHash, setUrlHash] = useState<string | null>(() => cachedUrlHash ?? null)
  const [error, setError] = useState(false)
  const [retryTick, setRetryTick] = useState(0)
  // 用 ref 保存最新回调，避免进入下方 effect 依赖数组
  const onFailedRef = useRef(onFailed)
  const onLoadedRef = useRef(onLoaded)
  const onCachedRef = useRef(onCached)
  useEffect(() => {
    onFailedRef.current = onFailed
    onLoadedRef.current = onLoaded
    onCachedRef.current = onCached
  })

  useEffect(() => {
    // If cache provides the data, use it directly and skip IPC fetch
    if (cachedUrlHash) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUrlHash(cachedUrlHash)
      setError(false)
      onLoadedRef.current?.(index)
      // 命中分支不调 onCached：值本就读自共享缓存，回写是 no-op（语义跳过）。
      return
    }

    // Reset state when url changes and no cache hit
    setUrlHash(null)
    setError(false)

    let cancelled = false
    const request = imageLoader
      ? imageLoader(url, index).then((imageUrl) => ({ urlHash: imageUrl }))
      : window.hcomic!.fetchPreviewImage(url, scrambleId, comicId, imageQuality)
    request
      .then((result) => {
        if (cancelled) return
        if (result?.urlHash) {
          setUrlHash(result.urlHash)
          onLoadedRef.current?.(index)
          // 回写共享缓存，使切换显示模式时新子树命中（见 specs/reader-image-cache）。
          onCachedRef.current?.(index, result.urlHash)
        } else {
          throw new Error('Empty response')
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true)
          onFailedRef.current?.(index)
        }
      })
    return () => { cancelled = true }
  }, [url, cachedUrlHash, scrambleId, comicId, imageQuality, retryTick, index, imageLoader])

  // 父级"全部重试"：retryGen 变化时，仅当当前处于 error 态才重置触发重载
  useEffect(() => {
    if (retryGen === undefined || retryGen === 0) return
    if (!error) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(false)
    setUrlHash(null)
    setRetryTick((t) => t + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryGen])

  // 本地单页重试（不污染父级 retryGen）
  const retry = () => {
    setError(false)
    setUrlHash(null)
    setRetryTick((t) => t + 1)
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 text-gray-400 text-xs" style={{ height: '100%' }}>
        <span>第 {index + 1} 页加载失败</span>
        <button
          onClick={retry}
          className="px-3 py-1 rounded bg-white/10 hover:bg-white/20 transition-colors text-xs"
        >
          重试
        </button>
      </div>
    )
  }

  if (!urlHash) {
    // 加载中：阅读器背景色 + 中心 spinner（见 preview-loading-placeholder 规范）。
    // 原用 Skeleton 走主题变量，浅色主题下在深色阅读器内形成白色色块。
    return (
      <ReaderPagePlaceholder className="h-full w-full" />
    )
  }

  return (
    <img
      src={imageLoader ? urlHash : buildImageUrl('preview', urlHash)}
      alt={`第 ${index + 1} 页`}
      className="h-full w-auto max-w-none"
      draggable={false}
      onError={() => {
        setError(true)
        onFailedRef.current?.(index)
      }}
    />
  )
}
