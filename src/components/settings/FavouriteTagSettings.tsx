import { useState, useEffect, useCallback } from 'react'
import { TAG_RECOMMENDATION_SOURCES, SOURCE_LABELS } from '@shared/types'
import { useFavouriteTags } from '../../hooks/useIpc'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { normalizeSourceKey } from '../../utils/source'

interface TagItem {
  tag: string
  count: number
}

export function FavouriteTagSettings() {
  const {
    favouriteTagHighlight, setFavouriteTagHighlight,
    favouriteTagMinMatches, setFavouriteTagMinMatches,
    myTags, addMyTag, removeMyTag,
    tagBlacklist,
  } = useSettingsStore()
  const { getFavouriteTags, syncFavouriteTags } = useFavouriteTags()
  const [source, setSource] = useState('hcomic')
  // 检测标签候选池（来自 favourite_tag_index，仅展示与挑选，不直接生效）
  const [detectedTags, setDetectedTags] = useState<TagItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<string | null>(null)
  const [syncedCount, setSyncedCount] = useState<number | null>(null)
  const [showAllDetected, setShowAllDetected] = useState(false)
  const [manualInput, setManualInput] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)
  const [opToast, setOpToast] = useState<string | null>(null)

  const sourceKey = normalizeSourceKey(source)
  const myTagList = myTags[sourceKey] ?? []
  const blacklistSet = new Set(tagBlacklist[sourceKey].map(t => t.toLowerCase()))
  const myTagSet = new Set(myTagList.map(t => t.toLowerCase()))

  const loadDetectedTags = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = await getFavouriteTags(source)
      setDetectedTags(result.tags)
    } catch {
      setDetectedTags([])
    } finally {
      setIsLoading(false)
    }
  }, [getFavouriteTags, source])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDetectedTags()
  }, [loadDetectedTags])

  const handleSync = async () => {
    setIsSyncing(true)
    setSyncedCount(null)
    setSyncProgress('正在同步...')
    try {
      const result = await syncFavouriteTags(source)
      setSyncedCount(result.totalComics)
      setDetectedTags(result.tags)
      setSyncProgress(null)
    } catch {
      setSyncedCount(null)
      setSyncProgress(null)
    } finally {
      setIsSyncing(false)
    }
  }

  const showToast = (msg: string) => {
    setOpToast(msg)
    setTimeout(() => setOpToast(null), 2500)
  }

  const handleAddManual = () => {
    const trimmed = manualInput.trim()
    if (!trimmed) {
      setInputError('标签不能为空')
      return
    }
    const ok = addMyTag(source, trimmed)
    if (!ok) {
      // 区分重复与互斥冲突
      if (myTagSet.has(trimmed.toLowerCase())) {
        setInputError('该标签已在推荐列表中')
      } else if (blacklistSet.has(trimmed.toLowerCase())) {
        setInputError('该标签已被屏蔽，请先取消屏蔽')
      } else {
        setInputError('添加失败（可能超过长度限制）')
      }
      return
    }
    setManualInput('')
    setInputError(null)
    showToast(`已加入推荐：${trimmed}`)
  }

  const handleRemoveMyTag = (tag: string) => {
    removeMyTag(source, tag)
    showToast(`已移除推荐：${tag}`)
  }

  const handlePickDetected = (tag: string) => {
    const ok = addMyTag(source, tag)
    if (!ok) {
      if (blacklistSet.has(tag.toLowerCase())) {
        showToast(`「${tag}」已被屏蔽，请先取消屏蔽`)
      }
      return
    }
    showToast(`已加入推荐：${tag}`)
  }

  const handleToggle = () => {
    setFavouriteTagHighlight(!favouriteTagHighlight)
  }

  return (
    <div id="section-favourite-tags" className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm space-y-6">
      <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
        <h3 className="text-base font-medium text-[var(--text-primary)]">推荐标签</h3>
        <button
          onClick={handleToggle}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            favouriteTagHighlight ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              favouriteTagHighlight ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      <p className="text-sm text-[var(--text-secondary)]">
        手动收藏你感兴趣的标签，搜索结果中命中推荐标签的漫画会被高亮显示。也可从下方「检测标签」候选池一键挑选。
      </p>

      <div className="flex items-center gap-3">
        <span className="text-sm text-[var(--text-secondary)]">最少命中标签数</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setFavouriteTagMinMatches(Math.max(1, favouriteTagMinMatches - 1))}
            disabled={favouriteTagMinMatches <= 1}
            className="w-7 h-7 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)]
                       text-[var(--text-primary)] flex items-center justify-center
                       disabled:opacity-30 hover:bg-[var(--bg-tertiary)] transition-colors text-sm"
          >
            −
          </button>
          <span className="w-8 text-center text-sm font-medium text-[var(--text-primary)] tabular-nums">
            {favouriteTagMinMatches}
          </span>
          <button
            onClick={() => setFavouriteTagMinMatches(Math.min(10, favouriteTagMinMatches + 1))}
            disabled={favouriteTagMinMatches >= 10}
            className="w-7 h-7 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)]
                       text-[var(--text-primary)] flex items-center justify-center
                       disabled:opacity-30 hover:bg-[var(--bg-tertiary)] transition-colors text-sm"
          >
            +
          </button>
        </div>
        <span className="text-xs text-[var(--text-secondary)]">
          漫画命中推荐标签数 ≥ 该值时才高亮
        </span>
      </div>

      <div className="flex items-center gap-3">
        <select
          value={source}
          onChange={e => setSource(e.target.value)}
          disabled={isSyncing}
          className="px-3 py-1.5 text-sm bg-[var(--bg-secondary)] border border-[var(--border)]
                     rounded-lg text-[var(--text-primary)]"
        >
          {TAG_RECOMMENDATION_SOURCES.map(s => (
            <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
          ))}
        </select>
      </div>

      {/* ── 推荐标签区（my_tags，高亮生效源）── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">
            推荐标签 ({SOURCE_LABELS[sourceKey as keyof typeof SOURCE_LABELS]})
          </span>
          <span className="text-xs text-[var(--text-secondary)]">{myTagList.length} 个</span>
        </div>
        <div className="flex flex-wrap gap-2 min-h-[2rem]">
          {myTagList.length === 0 ? (
            <span className="text-xs text-[var(--text-secondary)] italic py-1">
              暂无推荐标签，可手动添加或从下方检测标签挑选
            </span>
          ) : (
            myTagList.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full
                           bg-amber-500/15 text-amber-600 text-sm"
              >
                ★ {tag}
                <button
                  onClick={() => handleRemoveMyTag(tag)}
                  className="w-4 h-4 rounded-full text-[10px] flex items-center justify-center
                             text-amber-600/60 hover:text-[var(--error)] hover:bg-[var(--error)]/10 transition-colors"
                  title="移除推荐"
                >
                  ✕
                </button>
              </span>
            ))
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={manualInput}
            onChange={e => { setManualInput(e.target.value); setInputError(null) }}
            onKeyDown={e => { if (e.key === 'Enter') handleAddManual() }}
            placeholder="手动添加标签名（可添加 sync 未检测到的标签）"
            maxLength={64}
            className="flex-1 px-3 py-1.5 text-sm bg-[var(--bg-secondary)] border border-[var(--border)]
                       rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/60"
          />
          <button
            onClick={handleAddManual}
            className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-sm
                       hover:bg-amber-600 transition-colors"
          >
            添加
          </button>
        </div>
        {inputError && (
          <p className="text-xs text-[var(--error)]">{inputError}</p>
        )}
      </div>

      {/* ── 检测标签区（候选池，来自 favourite_tag_index，仅供挑选）── */}
      <div className="space-y-2 border-t border-[var(--border)] pt-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">
            检测标签（候选池）
          </span>
          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="px-3 py-1 rounded-lg bg-[var(--accent)]/10 text-[var(--accent)] text-xs
                       disabled:opacity-50 hover:bg-[var(--accent)]/20 transition-colors"
          >
            {isSyncing ? (syncProgress ?? '同步中...') : '从收藏夹同步'}
          </button>
        </div>
        <p className="text-xs text-[var(--text-secondary)]">
          基于收藏夹漫画统计的高频标签，点击挑选加入推荐。
          {syncedCount !== null && <span className="ml-1">已同步 {syncedCount} 本漫画。</span>}
        </p>
        {isLoading ? (
          <p className="text-sm text-[var(--text-secondary)] py-4 text-center">加载中...</p>
        ) : detectedTags.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)] py-4 text-center">
            请先同步收藏夹以生成检测标签
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 max-h-52 overflow-y-auto content-start">
              {detectedTags.slice(0, 10).map(({ tag, count }) => {
                const picked = myTagSet.has(tag.toLowerCase())
                return (
                  <button
                    key={tag}
                    onClick={() => picked ? handleRemoveMyTag(tag) : handlePickDetected(tag)}
                    disabled={!picked && blacklistSet.has(tag.toLowerCase())}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors ${
                      picked
                        ? 'bg-amber-500/15 text-amber-600/60 cursor-pointer opacity-60'
                        : blacklistSet.has(tag.toLowerCase())
                          ? 'bg-[var(--error)]/5 text-[var(--text-secondary)]/40 cursor-not-allowed line-through'
                          : 'bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 cursor-pointer'
                    }`}
                    title={picked ? '已加入推荐，点击移除' : blacklistSet.has(tag.toLowerCase()) ? '该标签已被屏蔽' : '点击加入推荐'}
                  >
                    {picked && '✓ '}{tag}
                    <span className="text-xs opacity-60">({count})</span>
                  </button>
                )
              })}
            </div>
            {detectedTags.length > 10 && (
              <button
                onClick={() => setShowAllDetected(true)}
                className="text-sm text-[var(--accent)] hover:underline"
              >
                管理全部检测标签 (共 {detectedTags.length} 个)
              </button>
            )}
          </>
        )}
      </div>

      {/* ── 全部检测标签弹窗 ── */}
      {showAllDetected && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={() => setShowAllDetected(false)}>
          <div
            className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-lg max-w-lg w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-medium text-[var(--text-primary)]">
                全部检测标签 ({SOURCE_LABELS[sourceKey as keyof typeof SOURCE_LABELS]})
              </h3>
              <button
                onClick={() => setShowAllDetected(false)}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-lg leading-none"
              >
                ✕
              </button>
            </div>
            <div className="flex flex-wrap gap-2 max-h-[60vh] overflow-y-auto content-start">
              {detectedTags.map(({ tag, count }) => {
                const picked = myTagSet.has(tag.toLowerCase())
                return (
                  <button
                    key={tag}
                    onClick={() => picked ? handleRemoveMyTag(tag) : handlePickDetected(tag)}
                    disabled={!picked && blacklistSet.has(tag.toLowerCase())}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors ${
                      picked
                        ? 'bg-amber-500/15 text-amber-600/60 cursor-pointer opacity-60'
                        : blacklistSet.has(tag.toLowerCase())
                          ? 'bg-[var(--error)]/5 text-[var(--text-secondary)]/40 cursor-not-allowed line-through'
                          : 'bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 cursor-pointer'
                    }`}
                    title={picked ? '已加入推荐，点击移除' : blacklistSet.has(tag.toLowerCase()) ? '该标签已被屏蔽' : '点击加入推荐'}
                  >
                    {picked && '✓ '}{tag}
                    <span className="text-xs opacity-60">({count})</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {opToast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg
                        bg-[var(--bg-tertiary)] text-[var(--text-primary)] text-sm shadow-lg border border-[var(--border)]">
          {opToast}
        </div>
      )}
    </div>
  )
}
