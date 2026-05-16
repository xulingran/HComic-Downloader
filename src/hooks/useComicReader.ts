import { useState, useCallback } from 'react'
import type { ComicInfo } from '@shared/types'

type LoadingState = 'idle' | 'loading' | 'loaded' | 'error'

interface UseComicReaderReturn {
  imageUrls: string[]
  totalPages: number
  currentPage: number
  loadingState: LoadingState
  errorMessage: string
  fetchUrls: (comic: ComicInfo) => Promise<void>
  setCurrentPage: (page: number) => void
  reset: () => void
}

type ImportMetaWithEnv = ImportMeta & { env?: { DEV?: boolean } }

function logPreviewDebug(message: string, details: Record<string, unknown>) {
  if ((import.meta as ImportMetaWithEnv).env?.DEV) {
    console.log(message, details)
  }
}

export function useComicReader(): UseComicReaderReturn {
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [totalPages, setTotalPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(0)
  const [loadingState, setLoadingState] = useState<LoadingState>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  const fetchUrls = useCallback(async (comic: ComicInfo) => {
    setLoadingState('loading')
    setErrorMessage('')
    logPreviewDebug('[preview] fetchUrls start', {
      id: comic.id,
      sourceSite: comic.sourceSite ?? 'hcomic',
      pages: comic.pages,
      mediaId: comic.mediaId,
      source: comic.source,
    })
    try {
      const result = await window.hcomic!.getPreviewUrls(comic)
      logPreviewDebug('[preview] fetchUrls success', {
        id: comic.id,
        urls: result.imageUrls.length,
        totalPages: result.totalPages,
      })
      setImageUrls(result.imageUrls)
      setTotalPages(result.totalPages)
      setCurrentPage(result.imageUrls.length > 0 ? 1 : 0)
      setLoadingState('loaded')
    } catch (err) {
      console.error('[preview] fetchUrls failed', err)
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load preview')
      setLoadingState('error')
    }
  }, [])

  const reset = useCallback(() => {
    setImageUrls([])
    setTotalPages(0)
    setCurrentPage(0)
    setLoadingState('idle')
    setErrorMessage('')
  }, [])

  return {
    imageUrls,
    totalPages,
    currentPage,
    loadingState,
    errorMessage,
    fetchUrls,
    setCurrentPage,
    reset,
  }
}
