import { useState, useCallback } from 'react'
import type { ChapterInfo, ComicInfo } from '@shared/types'

type LoadingState = 'idle' | 'loading' | 'loaded' | 'error'

interface UseComicReaderReturn {
  imageUrls: string[]
  totalPages: number
  currentPage: number
  loadingState: LoadingState
  errorMessage: string
  scrambleId: string
  comicId: string
  chapters: ChapterInfo[]
  fetchUrls: (comic: ComicInfo) => Promise<void>
  fetchChapterUrls: (chapterId: string, albumId?: string, sourceSite?: string) => Promise<void>
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
  const [chapters, setChapters] = useState<ChapterInfo[]>([])

  const fetchUrls = useCallback(async (comic: ComicInfo) => {
    setLoadingState('loading')
    setErrorMessage('')
    try {
      const result = await window.hcomic!.getPreviewUrls(comic)
      setImageUrls(result.imageUrls)
      setTotalPages(result.totalPages)
      setScrambleId(result.scrambleId ?? '')
      setComicId(result.comicId ?? '')
      setChapters(result.chapters ?? [])
      setCurrentPage(result.imageUrls.length > 0 ? 1 : 0)
      setLoadingState('loaded')
    } catch (err) {
      console.error('[preview] fetchUrls failed', err)
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load preview')
      setLoadingState('error')
    }
  }, [])

  const fetchChapterUrls = useCallback(async (chapterId: string, albumId?: string, sourceSite?: string) => {
    setLoadingState('loading')
    setErrorMessage('')
    try {
      const result = await window.hcomic!.getChapterPreviewUrls(chapterId, albumId, sourceSite)
      setImageUrls(result.imageUrls)
      setTotalPages(result.totalPages)
      setScrambleId(result.scrambleId ?? '')
      setComicId(result.comicId ?? '')
      setCurrentPage(result.imageUrls.length > 0 ? 1 : 0)
      setLoadingState('loaded')
    } catch (err) {
      console.error('[preview] fetchChapterUrls failed', err)
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load chapter')
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
    setChapters([])
  }, [])

  return {
    imageUrls,
    totalPages,
    currentPage,
    loadingState,
    errorMessage,
    scrambleId,
    comicId,
    chapters,
    fetchUrls,
    fetchChapterUrls,
    setCurrentPage,
    reset,
  }
}
