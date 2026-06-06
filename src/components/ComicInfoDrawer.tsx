import { useEffect, useState, useCallback, useMemo } from 'react'
import { SearchMode, type ComicInfo, type TagBlacklist } from '@shared/types'
import { useDrawerStore } from '../stores/useDrawerStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useAddToFavourites, useRemoveFromFavourites, useCheckFavourite, useComicDetail, useFavouriteTags } from '../hooks/useIpc'
import { Toast } from './common/Toast'
import { isAuthError } from '../utils/auth'

export function ComicInfoDrawer() {
  const { drawerComic, isOpen, closeDrawer, setPendingSearch } = useDrawerStore()
  const { tagBlacklist, favouriteTagHighlight, addTag, removeTag } = useSettingsStore()
  const { addToFavourites } = useAddToFavourites()
  const { removeFromFavourites } = useRemoveFromFavourites()
  const { checkFavourite } = useCheckFavourite()
  const { getComicDetail } = useComicDetail()
  const { getFavouriteTags } = useFavouriteTags()
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [confirmTag, setConfirmTag] = useState<{ tag: string; action: 'block' | 'unblock' } | null>(null)
  const [favouritesState, setFavouritesState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [favToastMessage, setFavToastMessage] = useState('')
  const [showFavToast, setShowFavToast] = useState(false)
  const [enrichedComic, setEnrichedComic] = useState<ComicInfo | null>(null)
  const [drawerFavTags, setDrawerFavTags] = useState<{ tag: string; count: number }[]>([])

  const comicSource = drawerComic?.sourceSite || 'hcomic'

  const recommendedTagSet = useMemo(() => {
    if (!favouriteTagHighlight || comicSource !== 'hcomic') return new Set<string>()
    return new Set(drawerFavTags.slice(0, 10).map(t => t.tag.toLowerCase()))
  }, [favouriteTagHighlight, comicSource, drawerFavTags])

  const displayComic = useMemo(() => {
    if (!drawerComic) return null
    if (!enrichedComic) return drawerComic
    return { ...drawerComic, ...enrichedComic }
  }, [drawerComic, enrichedComic])

  const sourceKeyMap: Record<string, keyof TagBlacklist> = { moeimg: 'moeimg', jmcomic: 'jmcomic', bika: 'bika', copymanga: 'copymanga' }

  const isTagBlocked = (tag: string) => {
    const key = sourceKeyMap[comicSource] ?? 'hcomic'
    return tagBlacklist[key].some(t => t.toLowerCase() === tag.toLowerCase())
  }

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMounted(true)
      requestAnimationFrame(() => setVisible(true))
    } else {
      setVisible(false)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !favouriteTagHighlight || comicSource !== 'hcomic') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDrawerFavTags([])
      return
    }
    getFavouriteTags('hcomic').then(result => setDrawerFavTags(result.tags)).catch(() => setDrawerFavTags([]))
  }, [isOpen, favouriteTagHighlight, comicSource, getFavouriteTags])

  // Fetch full detail for sources where search results lack complete metadata.
  // moeimg/jmcomic search cards omit some fields (full tag set, page count,
  // works/characters), so enrich from the detail page when the drawer opens.
  useEffect(() => {
    if (!isOpen || !drawerComic?.id) {
      return
    }
    if (comicSource !== 'moeimg' && comicSource !== 'jmcomic') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEnrichedComic(null)
      return
    }
    let cancelled = false
    setEnrichedComic(null)
    getComicDetail(drawerComic.id, comicSource)
      .then((result) => {
        if (!cancelled && result.comic) {
          setEnrichedComic(result.comic)
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, drawerComic?.id, comicSource])

  useEffect(() => {
    if (!isOpen || !drawerComic?.id || (comicSource !== 'hcomic' && comicSource !== 'moeimg')) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFavouritesState('idle')
      return
    }
    let cancelled = false
    setFavouritesState('loading')
    checkFavourite(drawerComic.id, comicSource)
      .then((result: { isFavourited: boolean }) => {
        if (!cancelled) {
          setFavouritesState(result.isFavourited ? 'success' : 'idle')
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFavouritesState('idle')
        }
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, drawerComic?.id, comicSource])

  const handleTransitionEnd = useCallback(() => {
    if (!visible) {
      setMounted(false)
    }
  }, [visible])

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDrawer()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, closeDrawer])

  const handleSearch = (query: string, mode: SearchMode, append = false) => {
    setPendingSearch(query, mode, append)
    closeDrawer()
  }

  const handleToggleFavourites = async () => {
    if (!drawerComic?.id || favouritesState === 'loading') return
    const isFavourited = favouritesState === 'success'
    setFavouritesState('loading')
    try {
      if (isFavourited) {
        await removeFromFavourites(drawerComic.id, comicSource)
        setFavouritesState('idle')
        setFavToastMessage('已移除收藏')
      } else {
        await addToFavourites(drawerComic.id, comicSource)
        setFavouritesState('success')
        setFavToastMessage('已加入收藏夹')
      }
      setShowFavToast(true)
    } catch (err: unknown) {
      if (isAuthError(err)) {
        setFavouritesState(isFavourited ? 'success' : 'error')
        setFavToastMessage('请先登录后再操作')
      } else {
        setFavouritesState(isFavourited ? 'success' : 'error')
        setFavToastMessage(isFavourited ? '移除收藏失败' : '加入收藏夹失败')
      }
      setShowFavToast(true)
    }
  }

  useEffect(() => {
    if (!showFavToast) return
    const timer = setTimeout(() => {
      setShowFavToast(false)
      if (favouritesState === 'error') {
        setFavouritesState('idle')
      }
    }, 3000)
    return () => clearTimeout(timer)
  }, [showFavToast, favouritesState])

  if (!mounted) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <Toast
        message={favToastMessage}
        visible={showFavToast}
        onDismiss={() => setShowFavToast(false)}
      />
      <div
        className={`absolute inset-0 transition-opacity duration-300 ${
          visible ? 'bg-black/50' : 'bg-black/0'
        }`}
        onClick={closeDrawer}
      />
      <div
        onTransitionEnd={handleTransitionEnd}
        className={`relative w-80 max-w-[85vw] bg-[var(--bg-primary)] shadow-2xl
                    flex flex-col overflow-y-auto
                    transition-transform duration-300 ease-out ${
                      visible ? 'translate-x-0' : 'translate-x-full'
                    }`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <span className="text-sm text-[var(--text-secondary)]">漫画详情</span>
          <button
            onClick={closeDrawer}
            className="w-7 h-7 flex items-center justify-center rounded-md
                       text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]
                       hover:text-[var(--text-primary)] transition-colors text-lg"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <h3 className="text-base font-medium text-[var(--text-primary)] leading-relaxed select-text">
            {displayComic?.title}
          </h3>

          {displayComic?.author ? (
            <div>
              <span className="text-xs text-[var(--text-secondary)]">作者</span>
              <button
                onClick={() => handleSearch(displayComic.author!, 'author')}
                className="block text-sm text-[var(--accent)] mt-0.5 cursor-pointer
                           hover:underline select-text text-left"
              >
                {displayComic.author}
              </button>
            </div>
          ) : (
            <div>
              <span className="text-xs text-[var(--text-secondary)]">作者</span>
              <p className="text-sm text-[var(--text-secondary)] mt-0.5">未知作者</p>
            </div>
          )}

          <div>
            <span className="text-xs text-[var(--text-secondary)]">信息</span>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-sm text-[var(--text-primary)] select-text">
                {displayComic?.sourceSite || displayComic?.source}
                {displayComic?.pages != null && displayComic.pages > 0 && (
                  <> · {displayComic.pages} 页</>
                )}
                {displayComic?.albumTotalChapters != null && displayComic.albumTotalChapters > 1 && (
                  <> · {displayComic.albumTotalChapters} 章</>
                )}
              </p>
              {displayComic?.url && (
                <button
                  onClick={() => window.hcomic?.openUrl(displayComic.url)}
                  className="text-xs px-2 py-0.5 rounded-md bg-[var(--accent)]/10 text-[var(--accent)]
                             hover:bg-[var(--accent)]/20 transition-colors flex-shrink-0"
                  title={displayComic.url}
                >
                  打开原网页
                </button>
              )}
            </div>
          </div>

          {(comicSource === 'hcomic' || comicSource === 'bika') && (
            <div>
              <button
                onClick={handleToggleFavourites}
                disabled={favouritesState === 'loading'}
                className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-colors ${
                  favouritesState === 'success'
                    ? 'bg-pink-500/10 text-pink-500 hover:bg-pink-500/20'
                    : 'bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20'
                } disabled:opacity-60`}
              >
                <svg
                  className="w-4 h-4 flex-shrink-0"
                  viewBox="0 0 24 24"
                  fill={favouritesState === 'success' ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
                  />
                </svg>
                <span>
                  {favouritesState === 'loading'
                    ? '处理中...'
                    : favouritesState === 'success'
                      ? '已加入收藏'
                      : '加入收藏'}
                </span>
              </button>
            </div>
          )}

          {displayComic?.tags && displayComic.tags.length > 0 && (
            <div>
              <span className="text-xs text-[var(--text-secondary)]">标签</span>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {displayComic.tags.map((tag, i) => {
                  const blocked = isTagBlocked(tag)
                  const isRec = !blocked && recommendedTagSet.has(tag.toLowerCase())
                  return (
                    <span key={i} className="relative group">
                      <button
                        onClick={() => handleSearch(tag, 'tag', true)}
                        className={`text-xs px-2.5 py-1 rounded-full cursor-pointer transition-colors ${
                          blocked
                            ? 'bg-[var(--error)]/10 text-[var(--error)] line-through opacity-60'
                            : isRec
                              ? 'bg-amber-500/15 text-amber-600 hover:bg-amber-500/25'
                              : 'bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20'
                        }`}
                      >
                        {tag}
                      </button>
                      <button
                        onClick={() => setConfirmTag({ tag, action: blocked ? 'unblock' : 'block' })}
                        className={`absolute -top-1 -right-1 w-4 h-4 rounded-full text-[10px] flex items-center justify-center
                                   opacity-0 group-hover:opacity-100 transition-opacity
                                   ${blocked
                                     ? 'bg-[var(--accent)] text-white'
                                     : 'bg-[var(--error)] text-white'
                                   }`}
                        title={blocked ? '取消屏蔽' : '屏蔽标签'}
                      >
                        {blocked ? '✓' : '×'}
                      </button>
                    </span>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {confirmTag && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center" onClick={() => setConfirmTag(null)}>
          <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-lg max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium text-[var(--text-primary)] mb-4">
              {confirmTag.action === 'block'
                ? `屏蔽标签「${confirmTag.tag}」？`
                : `取消屏蔽标签「${confirmTag.tag}」？`
              }
            </h3>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              {confirmTag.action === 'block'
                ? '包含该标签的漫画将从搜索结果中隐藏。'
                : '包含该标签的漫画将恢复显示在搜索结果中。'
              }
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmTag(null)}
                className="px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)]"
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (confirmTag.action === 'block') {
                    addTag(comicSource, confirmTag.tag)
                  } else {
                    removeTag(comicSource, confirmTag.tag)
                  }
                  setConfirmTag(null)
                }}
                className={`px-4 py-2 rounded-lg text-white ${
                  confirmTag.action === 'block'
                    ? 'bg-[var(--error)] hover:bg-[var(--error)]/80'
                    : 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]'
                }`}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
