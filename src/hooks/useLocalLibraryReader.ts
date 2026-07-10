import { useState, useCallback, useEffect, useRef } from 'react'
import { useLibrary } from './useIpc'
import type { LibraryChapter, ChapterInfo } from '@shared/types'

/**
 * 本地漫画库阅读器数据获取 hook。
 *
 * 镜像 ``useComicReader`` 的接口但使用漫画库 API：
 * - ``libraryDetail`` 获取章节列表
 * - ``libraryPageManifest`` 获取页清单
 * - ``libraryGetPage`` 获取单页图片 URL
 *
 * 远程预览阅读的 ``scrambleId``/``comicId`` 概念在本地阅读中不适用，
 * 页 URL 直接由后端返回完整的 ``app-image://library/<sha>`` 形式。
 */
export function useLocalLibraryReader() {
  const library = useLibrary()
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [totalPages, setTotalPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [loadingState, setLoadingState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [chapters, setChapters] = useState<ChapterInfo[]>([])
  const [assetVersion, setAssetVersion] = useState<number>(1)
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null)
  const versionRef = useRef(1)

  /** 获取指定章节的页面 URL 列表。 */
  const fetchChapterPages = useCallback(
    async (assetId: string, chapterId: string | null, version: number) => {
      try {
        const manifest = await library.pageManifest(assetId, chapterId ?? undefined)
        // 为每页生成占位 URL；实际图片 URL 在渲染时按需通过 getPage 获取
        // 这里用合成 URL 携带 assetId/chapterId/page/version 信息
        const urls = manifest.pages.map(
          (p) => `library://${assetId}/${chapterId ?? 'default'}/${p.index + 1}/${version}`,
        )
        setImageUrls(urls)
        setTotalPages(urls.length)
        versionRef.current = version
        setAssetVersion(version)
        setCurrentChapterId(chapterId)
        return urls.length
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : '获取页面清单失败')
        setLoadingState('error')
        throw err
      }
    },
    [library],
  )

  /** 获取资产详情和初始章节目清单。 */
  const fetchAsset = useCallback(
    async (assetId: string, initialChapterId?: string | null, resumePage?: number | null) => {
      setLoadingState('loading')
      setErrorMessage(null)
      try {
        const detail = await library.detail(assetId)
        versionRef.current = detail.version
        setAssetVersion(detail.version)

        // 构建章节列表
        const chs: ChapterInfo[] =
          detail.chapters.length > 0
            ? detail.chapters.map((ch: LibraryChapter) => ({
                id: ch.chapterId,
                name: ch.name,
                index: ch.index,
                pages: ch.pageCount,
              }))
            : [{ id: 'default', name: detail.title, index: 0, pages: detail.pageCount }]
        setChapters(chs)

        // 获取初始章节 manifest
        const initialCh = initialChapterId && chs.some((chapter) => chapter.id === initialChapterId)
          ? initialChapterId
          : chs[0]?.id || null
        const pageCount = await fetchChapterPages(assetId, initialCh, detail.version)

        // 恢复阅读进度
        if (resumePage && resumePage > 0) {
          setCurrentPage(Math.min(resumePage, Math.max(1, pageCount)))
        } else {
          setCurrentPage(1)
        }

        setLoadingState('loaded')
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : '加载漫画失败')
        setLoadingState('error')
      }
    },
    [library, fetchChapterPages],
  )

  /** 切换章节。 */
  const goToChapter = useCallback(
    async (assetId: string, chapterId: string | null) => {
      setLoadingState('loading')
      setErrorMessage(null)
      setCurrentPage(1)
      await fetchChapterPages(assetId, chapterId, versionRef.current)
      setLoadingState('loaded')
    },
    [fetchChapterPages],
  )

  /** 物化单页图片，返回完整 app-image:// URL。 */
  const materializePage = useCallback(
    async (assetId: string, chapterId: string | null, page: number): Promise<string> => {
      const result = await library.getPage(assetId, chapterId, page, versionRef.current)
      return result.imageUrl
    },
    [library],
  )

  const reset = useCallback(() => {
    setImageUrls([])
    setTotalPages(0)
    setCurrentPage(1)
    setLoadingState('idle')
    setErrorMessage(null)
    setChapters([])
    setAssetVersion(1)
    versionRef.current = 1
    setCurrentChapterId(null)
  }, [])

  return {
    imageUrls,
    totalPages,
    currentPage,
    loadingState,
    errorMessage,
    chapters,
    assetVersion,
    currentChapterId,
    setCurrentPage,
    fetchAsset,
    goToChapter,
    materializePage,
    reset,
  }
}

/**
 * 本地阅读进度管理——节流保存和关闭前 flush。
 */
export function useLocalLibraryProgress(assetId: string | null) {
  const library = useLibrary()
  const lastSaveRef = useRef(0)
  const pendingPageRef = useRef<{ chapterId: string | null; page: number; totalPages: number } | null>(null)
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const saveProgress = useCallback(
    (chapterId: string | null, page: number, totalPages: number, immediate = false) => {
      if (!assetId) return
      pendingPageRef.current = { chapterId, page, totalPages }

      const now = Date.now()
      const THROTTLE_MS = 5000 // 5 秒节流

      if (immediate || now - lastSaveRef.current >= THROTTLE_MS) {
        lastSaveRef.current = now
        const data = pendingPageRef.current
        pendingPageRef.current = null
        library.saveReadingProgress(assetId, data.chapterId, data.page, data.totalPages).catch(() => {})
      } else {
        // 延迟保存
        if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
        flushTimerRef.current = setTimeout(() => {
          const data = pendingPageRef.current
          if (data) {
            lastSaveRef.current = Date.now()
            pendingPageRef.current = null
            library.saveReadingProgress(assetId, data.chapterId, data.page, data.totalPages).catch(() => {})
          }
        }, THROTTLE_MS)
      }
    },
    [assetId, library],
  )

  /** flush 待保存进度——关闭阅读器前调用。 */
  const flush = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    const data = pendingPageRef.current
    if (data && assetId) {
      pendingPageRef.current = null
      library.saveReadingProgress(assetId, data.chapterId, data.page, data.totalPages).catch(() => {})
    }
  }, [assetId, library])

  useEffect(() => flush, [flush])

  return { saveProgress, flush }
}
