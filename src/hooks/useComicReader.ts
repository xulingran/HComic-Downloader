import { useState, useCallback } from 'react'
import type { ComicInfo } from '@shared/types'

type LoadingState = 'idle' | 'loading' | 'loaded' | 'error'

interface UseComicReaderReturn {
  imageUrls: string[]
  totalPages: number
  currentPage: number
  loadingState: LoadingState
  errorMessage: string
  scrambleId: string
  comicId: string
  fetchUrls: (comic: ComicInfo) => Promise<void>
  setCurrentPage: (page: number) => void
  reset: () => void
}

export function useComicReader(): UseComicReaderReturn {
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [totalPages, setTotalPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(0)
  const [loadingState, setLoadingState] = useState<LoadingState>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [scrambleId, setScrambleId] = useState('')
  const [comicId, setComicId] = useState('')

  const fetchUrls = useCallback(async (comic: ComicInfo) => {
    setLoadingState('loading')
    setErrorMessage('')
    try {
      const result = await window.hcomic!.getPreviewUrls(comic)
      setImageUrls(result.imageUrls)
      setTotalPages(result.totalPages)
      setScrambleId(result.scrambleId ?? '')
      setComicId(result.comicId ?? '')
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
    setScrambleId('')
    setComicId('')
  }, [])

  return {
    imageUrls,
    totalPages,
    currentPage,
    loadingState,
    errorMessage,
    scrambleId,
    comicId,
    fetchUrls,
    setCurrentPage,
    reset,
  }
}
