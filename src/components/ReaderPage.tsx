import { useState, useEffect, useRef } from 'react'

export function ReaderPage({ url, index, priority, cachedDataUri, scrambleId, comicId }: {
  url: string
  index: number
  priority?: boolean
  cachedDataUri?: string
  scrambleId?: string
  comicId?: string
}) {
  const [error, setError] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [dataUri, setDataUri] = useState<string | null>(null)
  const [retryTick, setRetryTick] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(false)
    setErrorMessage('')
    setDataUri(null)
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
    if (cachedDataUri && !dataUri) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDataUri(cachedDataUri)
      return
    }
    if (dataUri || error) return
    if (!isVisible && !priority) return
    let cancelled = false

    Promise.resolve()
      .then(() => window.hcomic!.fetchPreviewImage(url, scrambleId, comicId))
      .then((result) => {
        if (cancelled) return
        if (!result?.dataUri) {
          throw new Error('Empty preview image response')
        }
        setDataUri(result.dataUri)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[preview] fetchPreviewImage failed', { url, err })
        setErrorMessage(err instanceof Error ? err.message : '图片加载失败')
        setError(true)
      })
    return () => { cancelled = true }
  }, [cachedDataUri, dataUri, error, isVisible, priority, retryTick, url, scrambleId, comicId])

  const retry = () => {
    setError(false)
    setErrorMessage('')
    setDataUri(null)
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
    <div ref={containerRef} style={dataUri ? undefined : { aspectRatio: '3/4' }} className="relative flex items-center justify-center">
      {(isVisible || priority || dataUri) ? (
        <>
          {!dataUri && (
            <div className="absolute inset-0 flex items-center justify-center">
              <svg className="animate-spin h-6 w-6 text-gray-600" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          )}
          {dataUri && (
            <img
              src={dataUri}
              alt={`第 ${index + 1} 页`}
              onError={() => {
                setErrorMessage('浏览器无法解码后端返回的图片')
                setError(true)
              }}
              className="w-full h-auto"
            />
          )}
        </>
      ) : (
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
