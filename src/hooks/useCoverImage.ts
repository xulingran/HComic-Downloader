import { useState, useEffect, useRef, useCallback } from 'react'
import { buildImageUrl } from '@/lib/image-url'

/**
 * Lightweight memo of url → resolved outcome, keyed by the original cover URL.
 *
 * Unlike the pre-optimize-image-memory-pipeline design, this no longer holds
 * image bytes (no base64 data URIs anywhere in the pipeline). It only remembers
 * the *outcome* of a fetch so we don't refetch:
 *  - a string urlHash  → fetched OK, build the protocol URL from it
 *  - null              → fetch failed; don't retry on every render
 *
 * The actual image bytes live on disk and are streamed by Chromium via the
 * app-image:// protocol — they never enter the renderer JS heap, so there is
 * nothing large to evict here. This map holds only short hex strings / nulls.
 */
const coverOutcome = new Map<string, string | null>()
const pendingRequests = new Map<string, Promise<string | null>>()

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
        // 当没有观察目标时自动 disconnect，下次需要时重建
        if (observedElements.size === 0 && sharedObserver) {
          sharedObserver.disconnect()
          sharedObserver = null
        }
      },
      { rootMargin: '200px' }
    )
  }
  return sharedObserver
}

export function useCoverImage(coverUrl: string | undefined, containerRef?: React.RefObject<HTMLElement>, disabled?: boolean): { coverSrc: string | null | undefined; retry: () => void } {
  // coverSrc is now a protocol URL (or null/undefined sentinel), never a
  // base64 data URI.
  const [imageUrl, setImageUrl] = useState<string | null | undefined>(() => {
    if (disabled || !coverUrl) return null
    const outcome = coverOutcome.get(coverUrl)
    return outcome ? buildImageUrl('cover', outcome) : outcome
  })

  const currentUrlRef = useRef(coverUrl)
  currentUrlRef.current = coverUrl // eslint-disable-line react-hooks/refs
  const [retryTick, setRetryTick] = useState(0)
  const [isVisible, setIsVisible] = useState(!containerRef)

  // ── Reset to null when disabled ──
  useEffect(() => {
    if (disabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setImageUrl(null)
    }
  }, [disabled])

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
      // 所有观察目标已移除时 disconnect Observer
      if (observedElements.size === 0 && sharedObserver) {
        sharedObserver.disconnect()
        sharedObserver = null
      }
    }
  }, [containerRef])

  const fetchCover = useCallback(() => {
    if (disabled) return
    if (!currentUrlRef.current) {
      setImageUrl(null)
      return
    }
    const url = currentUrlRef.current

    const cached = coverOutcome.get(url)
    if (cached !== undefined) {
      setImageUrl(cached ? buildImageUrl('cover', cached) : null)
      return
    }

    let cancelled = false
    setImageUrl(undefined)

    // Deduplicate: reuse an in-flight request for the same URL
    const existing = pendingRequests.get(url)
    const promise = existing ?? (async (): Promise<string | null> => {
      try {
        const result = await window.hcomic!.fetchCover(url)
        const urlHash = result.urlHash as string
        coverOutcome.set(url, urlHash)
        return urlHash
      } catch {
        coverOutcome.set(url, null)
        return null
      } finally {
        pendingRequests.delete(url)
      }
    })()

    if (!existing) {
      pendingRequests.set(url, promise)
    }

    promise.then((urlHash) => {
      if (cancelled) return
      if (currentUrlRef.current === url) {
        setImageUrl(urlHash ? buildImageUrl('cover', urlHash) : null)
      }
    })

    return () => { cancelled = true }
  }, [disabled])

  // Load only when visible (or immediately if no containerRef)
  useEffect(() => {
    if (!isVisible) return
    return fetchCover()
  }, [coverUrl, retryTick, fetchCover, isVisible])

  const retry = useCallback(() => {
    if (coverUrl) {
      coverOutcome.delete(coverUrl)
      setRetryTick(t => t + 1)
    }
  }, [coverUrl])

  return { coverSrc: imageUrl, retry }
}
