import { useState, useEffect, useRef, useCallback } from 'react'

const coverCache = new Map<string, string | null>()
const pendingRequests = new Map<string, Promise<string | null>>()
const MAX_CACHE_SIZE = 200

// Shared IntersectionObserver for all cover images
let sharedObserver: IntersectionObserver | null = null
const observedElements = new Map<Element, () => void>()

function getSharedObserver(): IntersectionObserver {
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const callback = observedElements.get(entry.target)
            if (callback) {
              observedElements.delete(entry.target)
              sharedObserver?.unobserve(entry.target)
              callback()
            }
          }
        }
      },
      { rootMargin: '200px' }
    )
  }
  return sharedObserver
}

export function useCoverImage(coverUrl: string | undefined, containerRef?: React.RefObject<HTMLElement>): { coverSrc: string | null | undefined; retry: () => void } {
  const [dataUri, setDataUri] = useState<string | null | undefined>(() => {
    if (!coverUrl) return null
    if (coverCache.has(coverUrl)) return coverCache.get(coverUrl)
    return undefined
  })

  const currentUrlRef = useRef(coverUrl)
  currentUrlRef.current = coverUrl
  const [retryTick, setRetryTick] = useState(0)
  const [isVisible, setIsVisible] = useState(!containerRef)

  // ── IntersectionObserver for lazy loading ──
  useEffect(() => {
    if (!containerRef?.current) {
      setIsVisible(true)
      return
    }
    const el = containerRef.current
    const observer = getSharedObserver()
    observedElements.set(el, () => setIsVisible(true))
    observer.observe(el)
    return () => {
      observedElements.delete(el)
      observer.unobserve(el)
    }
  }, [containerRef])

  const fetchCover = useCallback(() => {
    if (!currentUrlRef.current) {
      setDataUri(null)
      return
    }
    const url = currentUrlRef.current

    if (coverCache.has(url)) {
      setDataUri(coverCache.get(url))
      return
    }

    let cancelled = false
    setDataUri(undefined)

    // Deduplicate: reuse an in-flight request for the same URL
    const existing = pendingRequests.get(url)
    const promise = existing ?? (async (): Promise<string | null> => {
      try {
        const result = await window.hcomic!.fetchCover(url)
        const uri = result.dataUri as string | null
        if (coverCache.size >= MAX_CACHE_SIZE) {
          const firstKey = coverCache.keys().next().value
          if (firstKey !== undefined) coverCache.delete(firstKey)
        }
        coverCache.set(url, uri)
        return uri
      } catch {
        coverCache.set(url, null)
        return null
      } finally {
        pendingRequests.delete(url)
      }
    })()

    if (!existing) {
      pendingRequests.set(url, promise)
    }

    promise.then((uri) => {
      if (cancelled) return
      if (currentUrlRef.current === url) {
        setDataUri(uri)
      }
    })

    return () => { cancelled = true }
  }, [])

  // Load only when visible (or immediately if no containerRef)
  useEffect(() => {
    if (!isVisible) return
    return fetchCover()
  }, [coverUrl, retryTick, fetchCover, isVisible])

  const retry = useCallback(() => {
    if (coverUrl) {
      coverCache.delete(coverUrl)
      setRetryTick(t => t + 1)
    }
  }, [coverUrl])

  return { coverSrc: dataUri, retry }
}
