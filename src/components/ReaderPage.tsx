import { useState, useEffect, useRef } from 'react'
import { buildImageUrl } from '@/lib/image-url'
import { ReaderPagePlaceholder } from './common/ReaderPagePlaceholder'

interface ReaderPageProps {
  url: string
  index: number
  priority?: boolean
  cachedUrlHash?: string
  scrambleId?: string
  comicId?: string
  imageQuality?: string
  /** 加载失败时上报（IPC 失败或图片解码失败均触发） */
  onFailed?: (index: number) => void
  /** 加载成功时上报（用于从失败集合中移除） */
  onLoaded?: (index: number) => void
  /** 取图成功后回写共享缓存（见 specs/reader-image-cache） */
  onCached?: (index: number, urlHash: string) => void
  /** 父级"全部重试"代数；变化时若当前处于 error 态则重置触发重载 */
  retryGen?: number
  /** Optional local/custom image loader. Returns a final browser-readable URL. */
  imageLoader?: (url: string, index: number) => Promise<string>
}

export function ReaderPage({ url, index, priority, cachedUrlHash, scrambleId, comicId, imageQuality, onFailed, onLoaded, onCached, retryGen, imageLoader }: ReaderPageProps) {
  const [error, setError] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [urlHash, setUrlHash] = useState<string | null>(null)
  const [retryTick, setRetryTick] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)
  // 用 ref 保存最新回调，避免它们进入下方 effect 依赖数组导致重载循环
  const onFailedRef = useRef(onFailed)
  const onLoadedRef = useRef(onLoaded)
  const onCachedRef = useRef(onCached)
  useEffect(() => {
    onFailedRef.current = onFailed
    onLoadedRef.current = onLoaded
    onCachedRef.current = onCached
  })

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(false)
    setErrorMessage('')
    setUrlHash(null)
    setRetryTick(0)
  }, [url])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setIsVisible(true) },
      { rootMargin: '2000px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (cachedUrlHash && !urlHash) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUrlHash(cachedUrlHash)
      onLoadedRef.current?.(index)
      return
    }
    if (urlHash || error) return
    if (!isVisible && !priority) return
    let cancelled = false

    Promise.resolve()
      .then(async () => {
        if (imageLoader) return imageLoader(url, index)
        const result = await window.hcomic!.fetchPreviewImage(url, scrambleId, comicId, imageQuality)
        if (!result?.urlHash) throw new Error('Empty preview image response')
        return result.urlHash
      })
      .then((result) => {
        if (cancelled) return
        if (!result) throw new Error('Empty image response')
        setUrlHash(result)
        onLoadedRef.current?.(index)
        // 回写共享缓存，使切换显示模式时新子树命中（见 specs/reader-image-cache）。
        // 缓存命中分支（上方 cachedUrlHash）不调：该值本就读自共享缓存，回写是 no-op。
        onCachedRef.current?.(index, result)
      })
      .catch((err) => {
        if (cancelled) return
        console.error(imageLoader ? '[library-reader] image load failed' : '[preview] fetchPreviewImage failed', { url, err })
        setErrorMessage(err instanceof Error ? err.message : '图片加载失败')
        setError(true)
        onFailedRef.current?.(index)
      })
    return () => { cancelled = true }
  }, [cachedUrlHash, urlHash, error, isVisible, priority, retryTick, url, scrambleId, comicId, imageQuality, index, imageLoader])

  // 父级"全部重试"：retryGen 变化时，仅当当前处于 error 态才重置触发重载。
  // 已成功页（urlHash 存在、无 error）不受打扰。
  useEffect(() => {
    if (retryGen === undefined) return
    if (retryGen === 0) return // 初始值，不触发
    if (!error) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(false)
    setErrorMessage('')
    setUrlHash(null)
    setRetryTick((t) => t + 1)
    // 仅依赖 retryGen 与 error；其余 state 通过 set 触发既有加载 effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryGen])

  const retry = () => {
    setError(false)
    setErrorMessage('')
    setUrlHash(null)
    setRetryTick(t => t + 1)
  }

  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 text-gray-400"
        style={{ aspectRatio: '3/4' }}
      >
        <span className="text-xs">第 {index + 1} 页加载失败</span>
        {errorMessage && <span className="max-w-full truncate px-3 text-[10px] text-gray-500">{errorMessage}</span>}
        <button
          onClick={retry}
          className="text-xs px-3 py-1 rounded bg-white/10 hover:bg-white/20 transition-colors"
        >
          重试
        </button>
      </div>
    )
  }

  return (
    <div ref={containerRef} style={urlHash ? undefined : { aspectRatio: '3/4' }} className="relative flex items-center justify-center">
      {(isVisible || priority || urlHash) ? (
        <>
          {!urlHash && (
            // 加载中：阅读器背景色 + 中心 spinner（见 preview-loading-placeholder 规范）。
            // 外层 absolute inset-0 让占位填满父级 3/4 比例容器，spinner 居中。
            <div className="absolute inset-0">
              <ReaderPagePlaceholder className="h-full w-full" />
            </div>
          )}
          {urlHash && (
            <img
              src={imageLoader ? urlHash : buildImageUrl('preview', urlHash)}
              alt={`第 ${index + 1} 页`}
              onError={() => {
                setErrorMessage('浏览器无法解码后端返回的图片')
                setError(true)
                onFailedRef.current?.(index)
              }}
              className="w-full h-auto"
            />
          )}
        </>
      ) : (
        // 未进入视口（懒加载占位）：保留横纹二态区分，避免满屏 spinner 喧闹。
        <div
          className="w-full h-full"
          style={{
            background: 'repeating-linear-gradient(0deg, transparent, transparent 8px, rgba(255,255,255,0.03) 8px, rgba(255,255,255,0.03) 16px)',
          }}
        />
      )}
    </div>
  )
}
