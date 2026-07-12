import { useEffect, useRef, useState } from 'react'
import type { ComicInfo } from '@shared/types'
import { ComicDetailSurface } from './ComicInfoDrawer'

interface OnlineReaderDetailPageProps {
  comic: ComicInfo
  active: boolean
  observeVisibility?: boolean
  onCloseReader: () => void
}

/** Non-image tail page for the online reader. */
export function OnlineReaderDetailPage({
  comic,
  active,
  observeVisibility = false,
  onCloseReader,
}: OnlineReaderDetailPageProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [nearViewport, setNearViewport] = useState(false)

  useEffect(() => {
    if (!observeVisibility) return
    const element = rootRef.current
    if (!element) return
    const observer = new IntersectionObserver(
      (entries) => setNearViewport(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: '400px 0px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [observeVisibility])

  return (
    <div
      ref={rootRef}
      data-reader-detail-page
      className="w-full min-h-full flex justify-center py-3"
    >
      <ComicDetailSurface
        comic={comic}
        active={active || nearViewport}
        surface="reader"
        onClose={onCloseReader}
      />
    </div>
  )
}
