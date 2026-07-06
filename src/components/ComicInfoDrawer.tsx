import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { SearchMode, type ComicInfo } from '@shared/types'
import { useDrawerStore } from '../stores/useDrawerStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useAddToFavourites, useRemoveFromFavourites, useCheckFavourite, useComicDetail } from '../hooks/useIpc'
import { Toast } from './common/Toast'
import { Modal } from './common/Modal'
import { drawerPresenceVariants, overlayPresenceVariants, reduceSafe, tagListVariants, tagItemVariants, useReducedMotionPreference } from '../lib/anim'
import { isAuthError } from '../utils/auth'
import { normalizeSourceKey, sourceSupportsFavourites, sourceSupportsTagRecommendation, sourceNeedsDetailEnrich } from '../utils/source'

// 标签操作四态：block/unblock（屏蔽）/favourite/unfavourite（推荐）。
// favourite 分支弹窗内还会派生 block 作为次级操作。
type TagConfirmAction = 'block' | 'unblock' | 'favourite' | 'unfavourite'

// 单操作确认弹窗配置：unfavourite / unblock 两态结构同构，仅文案与执行 action 不同，
// 用配置表驱动避免两段几乎相同的 JSX。favourite 分支（双操作选择器）结构不同，不在此表内。
const SINGLE_CONFIRM_LAYOUT: Record<'unfavourite' | 'unblock', { desc: string; confirmLabel: string }> = {
  unfavourite: {
    desc: '该标签已是推荐标签。取消后将不再高亮命中该标签的漫画。',
    confirmLabel: '取消推荐',
  },
  unblock: {
    desc: '该标签已被屏蔽。取消后包含该标签的漫画将恢复显示。',
    confirmLabel: '取消屏蔽',
  },
}

// 标签 chip 小按钮四态：由 blocked / favourited / canRecommend 三输入单次推导出 state，
// 再从下表一次性取出 action/icon/color/title 四字段，避免四个平行三元表达式各自重复判定
// （新增状态只改此表 + 推导链，不再需要同步四处）。
type TagButtonState = 'blocked' | 'favourited' | 'recommendable' | 'plain'
const TAG_BUTTON_STATE: Record<TagButtonState, { action: TagConfirmAction; icon: string; color: string; title: string }> = {
  blocked: { action: 'unblock', icon: '✓', color: 'bg-[var(--accent)] text-white', title: '取消屏蔽' },
  favourited: { action: 'unfavourite', icon: '★', color: 'bg-amber-500 text-white', title: '取消推荐' },
  recommendable: {
    action: 'favourite',
    icon: '+',
    color: 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]',
    title: '加入推荐 / 屏蔽',
  },
  plain: { action: 'block', icon: '+', color: 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]', title: '加入屏蔽' },
}

export function ComicInfoDrawer() {
  const { drawerComic, isOpen, closeDrawer, setPendingSearch } = useDrawerStore()
  const { tagBlacklist, myTags, favouriteTagHighlight, addTag, removeTag, addMyTag, removeMyTag } = useSettingsStore()
  const { addToFavourites } = useAddToFavourites()
  const { removeFromFavourites } = useRemoveFromFavourites()
  const { checkFavourite } = useCheckFavourite()
  const { getComicDetail } = useComicDetail()
  // 变更 2：改用 framer-motion AnimatePresence 驱动抽屉进出场，删除 useModalAnimation。
  // Toast 在 AnimatePresence 之外（避免 Drawer 关闭时 Toast 被 unmount）。
  const reduceMotion = useReducedMotionPreference()
  const drawerVariants = reduceMotion ? reduceSafe(drawerPresenceVariants) : drawerPresenceVariants
  const [confirmTag, setConfirmTag] = useState<{ tag: string; action: TagConfirmAction } | null>(null)
  const [favouritesState, setFavouritesState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [favToastMessage, setFavToastMessage] = useState('')
  const [showFavToast, setShowFavToast] = useState(false)
  // 标签操作冲突提示（如尝试加入推荐但已屏蔽）
  const [tagOpToastMessage, setTagOpToastMessage] = useState('')
  const [showTagOpToast, setShowTagOpToast] = useState(false)
  // Tag 点击不关闭抽屉（多选搜索），用独立 toast 提示已加入搜索；
  // 用 ref 持有计时器，支持连续点击多个 tag 时重置计时。
  const [tagToastMessage, setTagToastMessage] = useState('')
  const [showTagToast, setShowTagToast] = useState(false)
  const tagToastTimerRef = useRef<number>(0)
  const [enrichedComic, setEnrichedComic] = useState<ComicInfo | null>(null)
  // enrich 状态机：与 favouritesState 同构的四态。
  // idle=未触发 enrich；loading=请求中；success=拿到 comic；error=请求抛错或 comic 为 null（原 bug 静默忽略 null）。
  const [enrichState, setEnrichState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  // retryCount 驱动 enrich effect 重新执行（点击重试时自增），避免把 fetch 逻辑抽成独立函数。
  const [retryCount, setRetryCount] = useState(0)

  const comicSource = drawerComic?.sourceSite || 'hcomic'

  // 推荐态数据源：用户主动确认的 my_tags（取代旧版被动反推的 drawerFavTags）。
  const recommendedTagSet = useMemo(() => {
    if (!favouriteTagHighlight || !sourceSupportsTagRecommendation(comicSource)) return new Set<string>()
    const key = normalizeSourceKey(comicSource)
    return new Set(myTags[key].map(t => t.toLowerCase()))
  }, [favouriteTagHighlight, comicSource, myTags])

  const displayComic = useMemo(() => {
    if (!drawerComic) return null
    if (!enrichedComic) return drawerComic
    return { ...drawerComic, ...enrichedComic }
  }, [drawerComic, enrichedComic])

  const isTagBlocked = (tag: string) => {
    const key = normalizeSourceKey(comicSource)
    return tagBlacklist[key].some(t => t.toLowerCase() === tag.toLowerCase())
  }

  const isTagFavourited = (tag: string) => {
    const key = normalizeSourceKey(comicSource)
    return myTags[key].some(t => t.toLowerCase() === tag.toLowerCase())
  }

  // Fetch full detail for sources where search results lack complete metadata.
  // moeimg/jm search cards omit some fields (full tag set, page count,
  // works/characters), so enrich from the detail page when the drawer opens.
  // Also enrich when comic data lacks tags (e.g. from history records) regardless of source.
  // 失败（请求抛错 或 comic===null，后者是 JM 详情页被 Cloudflare/限制级拦截的主要形态）
  // 必须置为 error 状态供 UI 反馈，禁止静默吞错。
  useEffect(() => {
    if (!isOpen || !drawerComic?.id) {
      return
    }
    const hasCompleteData = Array.isArray(drawerComic.tags) && drawerComic.tags.length > 0
    if (!sourceNeedsDetailEnrich(comicSource) && hasCompleteData) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEnrichedComic(null)
      setEnrichState('idle')
      return
    }
    let cancelled = false
    setEnrichedComic(null)
    setEnrichState('loading')
    getComicDetail(drawerComic.id, comicSource, drawerComic.url || '')
      .then((result) => {
        if (cancelled) return
        if (result.comic) {
          setEnrichedComic(result.comic)
          setEnrichState('success')
        } else {
          // comic===null：详情页请求失败（拦截/限流/下架）。原代码静默忽略，这是 bug 核心。
          setEnrichState('error')
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEnrichState('error')
        }
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, drawerComic?.id, comicSource, retryCount])

  // 手动重试 enrich：自增 retryCount 驱动上面的 effect 重新执行。
  // 不关闭抽屉、不重置其它状态（如收藏状态），仅重跑 enrich。
  const retryEnrich = useCallback(() => {
    setEnrichState('loading')
    setRetryCount(n => n + 1)
  }, [])

  // enrich 状态 UI 的显示条件封装（与 enrich effect 的进入条件同构）。
  // shouldEnrich 保证只在"本就需要 enrich"的场景反馈，避免对列表项自带 tags 的来源误报；
  // tagsEmpty 保证列表项已有 tags 时即便 enrich 失败也正常展示 tags 而非状态 UI。
  const hasCompleteData = Array.isArray(drawerComic?.tags) && drawerComic.tags.length > 0
  const shouldEnrich = sourceNeedsDetailEnrich(comicSource) || !hasCompleteData
  const tagsEmpty = !(displayComic?.tags && displayComic.tags.length > 0)
  const showEnrichLoading = shouldEnrich && tagsEmpty && enrichState === 'loading'
  const showEnrichError = shouldEnrich && tagsEmpty && enrichState === 'error'

  useEffect(() => {
    if (!isOpen || !drawerComic?.id || !sourceSupportsFavourites(comicSource)) {
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

  // 点击 tag 加入搜索但不关闭抽屉，方便用户多选 tag 连续搜索。
  // parodies/characters/author 等替换式搜索仍走 handleSearch（关闭抽屉）。
  const handleTagSearch = (tag: string) => {
    setPendingSearch(tag, 'tag', true)
    setTagToastMessage(`已加入搜索：${tag}`)
    setShowTagToast(true)
    clearTimeout(tagToastTimerRef.current)
    tagToastTimerRef.current = window.setTimeout(() => setShowTagToast(false), 3000)
  }

  useEffect(() => {
    return () => clearTimeout(tagToastTimerRef.current)
  }, [])

  // 执行标签操作（加入/取消 推荐 或 屏蔽），处理互斥冲突的可见反馈。
  // action → handler 映射：写入型（block/favourite）失败返回 false 并自行设置冲突 toast；
  // 移除型（unblock/unfavourite）无返回值。返回 false 时保留弹窗等用户处理冲突。
  const tagActionHandlers: Record<TagConfirmAction, (tag: string) => boolean | void> = {
    block: (tag) => {
      if (!addTag(comicSource, tag)) {
        setTagOpToastMessage(`无法屏蔽：该标签已是推荐标签，请先取消推荐`)
        setShowTagOpToast(true)
        return false
      }
    },
    favourite: (tag) => {
      if (!addMyTag(comicSource, tag)) {
        setTagOpToastMessage(`无法加入推荐：该标签已被屏蔽，请先取消屏蔽`)
        setShowTagOpToast(true)
        return false
      }
    },
    unblock: (tag) => removeTag(comicSource, tag),
    unfavourite: (tag) => removeMyTag(comicSource, tag),
  }

  const handleConfirmTagAction = (tag: string, action: TagConfirmAction) => {
    const ok = tagActionHandlers[action](tag)
    if (ok === false) return
    setConfirmTag(null)
  }

  useEffect(() => {
    if (!showTagOpToast) return
    const timer = setTimeout(() => setShowTagOpToast(false), 3000)
    return () => clearTimeout(timer)
  }, [showTagOpToast])

  const handleToggleFavourites = async () => {
    if (!drawerComic?.id || favouritesState === 'loading') return
    const isFavourited = favouritesState === 'success'
    setFavouritesState('loading')
    try {
      if (isFavourited) {
        const result = await removeFromFavourites(drawerComic.id, comicSource)
        if (!result.success) {
          setFavouritesState('success')
          setFavToastMessage('移除收藏失败')
          setShowFavToast(true)
          return
        }
        setFavouritesState('idle')
        setFavToastMessage('已移除收藏')
      } else {
        const result = await addToFavourites(drawerComic.id, comicSource)
        if (!result.success) {
          setFavouritesState('error')
          setFavToastMessage('加入收藏夹失败')
          setShowFavToast(true)
          return
        }
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

  return (
    <div className="fixed inset-0 z-50 flex justify-end pointer-events-none">
      <div className="pointer-events-auto">
        <Toast
          message={favToastMessage}
          visible={showFavToast}
          onDismiss={() => setShowFavToast(false)}
        />
        <Toast
          message={tagToastMessage}
          visible={showTagToast}
          onDismiss={() => setShowTagToast(false)}
        />
        <Toast
          message={tagOpToastMessage}
          visible={showTagOpToast}
          onDismiss={() => setShowTagOpToast(false)}
        />
      </div>
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              key="drawer-overlay"
              variants={overlayPresenceVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="absolute inset-0 bg-black/50 pointer-events-auto"
              onClick={closeDrawer}
            />
            <motion.div
              key="drawer-panel"
              variants={drawerVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="relative w-80 max-w-[85vw] bg-[var(--bg-primary)] shadow-2xl
                         flex flex-col overflow-y-auto pointer-events-auto"
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
                {displayComic?.publishDate && (
                  <> · 更新 {displayComic.publishDate}</>
                )}
                {displayComic?.language && (
                  <> · {displayComic.language}</>
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
            {displayComic?.category && (
              <button
                onClick={() => handleSearch(displayComic.category!, 'category')}
                className="block text-sm text-[var(--accent)] mt-1 cursor-pointer
                           hover:underline select-text text-left"
              >
                {displayComic.category}
              </button>
            )}
          </div>

          {sourceSupportsFavourites(comicSource) && (
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

          {displayComic?.parodies && displayComic.parodies.length > 0 && (
            <div>
              <span className="text-xs text-[var(--text-secondary)]">原著</span>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {displayComic.parodies.map((parody, i) => (
                  <span key={i} className="relative group">
                    <button
                      onClick={() => handleSearch(parody, 'tag')}
                      className="text-xs px-2.5 py-1 rounded-full cursor-pointer transition-colors bg-purple-500/10 text-purple-400 hover:bg-purple-500/20"
                    >
                      {parody}
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {displayComic?.characters && displayComic.characters.length > 0 && (
            <div>
              <span className="text-xs text-[var(--text-secondary)]">角色</span>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {displayComic.characters.map((char, i) => (
                  <span key={i} className="relative group">
                    <button
                      onClick={() => handleSearch(char, 'tag')}
                      className="text-xs px-2.5 py-1 rounded-full cursor-pointer transition-colors bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20"
                    >
                      {char}
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {displayComic?.groups && displayComic.groups.length > 0 && (
            <div>
              <span className="text-xs text-[var(--text-secondary)]">制作组</span>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {displayComic.groups.map((group, i) => (
                  <span key={i} className="relative group">
                    <button
                      onClick={() => handleSearch(group, 'tag')}
                      className="text-xs px-2.5 py-1 rounded-full cursor-pointer transition-colors bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                    >
                      {group}
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {showEnrichLoading && (
            <div>
              <span className="text-xs text-[var(--text-secondary)]">标签</span>
              <div className="mt-2 text-sm text-[var(--text-secondary)]">标签加载中...</div>
            </div>
          )}

          {showEnrichError && (
            <div>
              <span className="text-xs text-[var(--text-secondary)]">标签</span>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-sm text-[var(--error)]">标签加载失败</span>
                <button
                  onClick={retryEnrich}
                  className="text-xs px-2 py-0.5 rounded-md bg-[var(--accent)]/10 text-[var(--accent)]
                             hover:bg-[var(--accent)]/20 transition-colors"
                >
                  重试
                </button>
              </div>
            </div>
          )}

          {displayComic?.tags && displayComic.tags.length > 0 && (
            <div>
              <span className="text-xs text-[var(--text-secondary)]">标签</span>
              {(() => {
                // tag 列表错峰：前 STAGGER_LIMIT 个 tag 参与 stagger（20ms 间隔），
                // 总时长 ≈ 100ms + (N-1) * 20ms，40 个 tag 约 0.88s。
                // 超出部分用普通 span 立即渲染，避免大量 motion 元素造成无意义开销。
                // reduced-motion 时全部用普通元素，不触发 stagger。
                const STAGGER_LIMIT = 40
                const tags = displayComic!.tags!
                const renderTag = (tag: string, idx: number, animate: boolean) => {
                  const blocked = isTagBlocked(tag)
                  const favourited = isTagFavourited(tag)
                  const isRec = !blocked && recommendedTagSet.has(tag.toLowerCase())
                  const Wrapper = animate ? motion.span : 'span'
                  const wrapperProps = animate ? { variants: tagItemVariants } : {}
                  // 来源能力门控：仅当 sourceSupportsTagRecommendation 为真时才暴露推荐动作。
                  // 不支持推荐的来源（如 NH / copymanga）下，未设置态退化为「加入屏蔽」(block)，
                  // 已屏蔽态仍为「取消屏蔽」(unblock)——禁止出现无法生效的 favourite 写入。
                  // 小按钮四态由 blocked/favourited/canRecommend 单次推导后查 TAG_BUTTON_STATE 取字段。
                  const canRecommend = sourceSupportsTagRecommendation(comicSource)
                  const buttonState: TagButtonState = blocked
                    ? 'blocked'
                    : favourited && canRecommend
                      ? 'favourited'
                      : canRecommend
                        ? 'recommendable'
                        : 'plain'
                  const { action: btnAction, icon: btnIcon, color: btnColor, title: btnTitle } = TAG_BUTTON_STATE[buttonState]
                  return (
                    <Wrapper key={idx} className="relative group" {...wrapperProps}>
                      <button
                        onClick={() => handleTagSearch(tag)}
                        className={`text-xs px-2.5 py-1 rounded-full cursor-pointer transition-colors ${
                          blocked
                            ? 'bg-[var(--error)]/10 text-[var(--error)] line-through opacity-60'
                            : isRec
                              ? 'bg-amber-500/20 text-amber-700 hover:bg-amber-500/30'
                              : 'bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20'
                        }`}
                      >
                        {tag}
                      </button>
                      <button
                        onClick={() => setConfirmTag({ tag, action: btnAction })}
                        className={`absolute -top-1 -right-1 w-4 h-4 rounded-full text-[10px] flex items-center justify-center
                                   opacity-0 group-hover:opacity-100 transition-opacity ${btnColor}`}
                        title={btnTitle}
                      >
                        {btnIcon}
                      </button>
                    </Wrapper>
                  )
                }
                if (reduceMotion) {
                  return (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {tags.map((tag, i) => renderTag(tag, i, false))}
                    </div>
                  )
                }
                const staggered = tags.slice(0, STAGGER_LIMIT)
                const rest = tags.slice(STAGGER_LIMIT)
                return (
                  <>
                    <motion.div
                      className="flex flex-wrap gap-1.5 mt-2"
                      variants={tagListVariants}
                      initial="hidden"
                      animate="show"
                    >
                      {staggered.map((tag, i) => renderTag(tag, i, true))}
                    </motion.div>
                    {rest.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {rest.map((tag, i) => renderTag(tag, STAGGER_LIMIT + i, false))}
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          )}
        </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <div className="pointer-events-auto">
        <Modal
          isOpen={!!confirmTag}
          onClose={() => setConfirmTag(null)}
          zIndex={60}
          contentClassName="bg-[var(--bg-primary)] rounded-xl p-6 shadow-lg max-w-sm w-full"
        >
        {confirmTag && (
          <>
            <h3 className="text-base font-medium text-[var(--text-primary)] mb-4">
              标签「{confirmTag.tag}」
            </h3>
            {confirmTag.action === 'favourite' ? (
              // 未设置态（支持推荐的来源）：提供「加入推荐」与「屏蔽」两个选项
              <>
                <p className="text-sm text-[var(--text-secondary)] mb-4">
                  选择对该标签的操作：
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => handleConfirmTagAction(confirmTag.tag, 'favourite')}
                    className="px-4 py-2 rounded-lg bg-amber-500 text-white text-sm hover:bg-amber-600 transition-colors text-left"
                  >
                    ★ 加入推荐标签
                    <span className="block text-xs opacity-80 mt-0.5">命中该标签的漫画将被高亮</span>
                  </button>
                  <button
                    onClick={() => handleConfirmTagAction(confirmTag.tag, 'block')}
                    className="px-4 py-2 rounded-lg bg-[var(--error)] text-white text-sm hover:bg-[var(--error)]/80 transition-colors text-left"
                  >
                    × 加入屏蔽标签
                    <span className="block text-xs opacity-80 mt-0.5">包含该标签的漫画将从搜索结果隐藏</span>
                  </button>
                </div>
              </>
            ) : confirmTag.action === 'block' ? (
              // 不支持推荐来源的未设置态：仅提供「加入屏蔽」单操作确认
              // （该来源禁止 favourite，未设置态小按钮直接映射为 block 初始动作）
              (() => (
                <>
                  <p className="text-sm text-[var(--text-secondary)] mb-4">
                    将屏蔽标签「{confirmTag.tag}」，包含该标签的漫画将从搜索结果隐藏。
                  </p>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setConfirmTag(null)}
                      className="px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)]"
                    >
                      取消
                    </button>
                    <button
                      onClick={() => handleConfirmTagAction(confirmTag.tag, 'block')}
                      className="px-4 py-2 rounded-lg bg-[var(--error)] text-white hover:bg-[var(--error)]/80"
                    >
                      加入屏蔽
                    </button>
                  </div>
                </>
              ))()
            ) : (
              // 已推荐 / 已屏蔽态：配置驱动的单操作确认（unfavourite / unblock 结构同构）
              // 控制流保证此处 action 只可能是 unfavourite / unblock（favourite 与 block 已被前两分支处理）。
              (() => {
                const action = confirmTag.action as 'unfavourite' | 'unblock'
                const layout = SINGLE_CONFIRM_LAYOUT[action]
                return (
                  <>
                    <p className="text-sm text-[var(--text-secondary)] mb-4">{layout.desc}</p>
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setConfirmTag(null)}
                        className="px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)]"
                      >
                        取消
                      </button>
                      <button
                        onClick={() => handleConfirmTagAction(confirmTag.tag, action)}
                        className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
                      >
                        {layout.confirmLabel}
                      </button>
                    </div>
                  </>
                )
              })()
            )}
            {/* 兜底关闭按钮（所有态通用） */}
            <div className="flex justify-end mt-4">
              <button
                onClick={() => setConfirmTag(null)}
                className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                关闭
              </button>
            </div>
          </>
        )}
      </Modal>
      </div>
    </div>
  )
}
