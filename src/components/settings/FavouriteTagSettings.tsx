import { useState, useEffect, useCallback } from 'react'
import { TAG_RECOMMENDATION_SOURCES, SOURCE_LABELS } from '@shared/types'
import { useFavouriteTags } from '../../hooks/useIpc'
import { useSettingsStore } from '../../stores/useSettingsStore'

interface TagItem {
  tag: string
  count: number
}

export function FavouriteTagSettings() {
  const { favouriteTagHighlight, setFavouriteTagHighlight, favouriteTagMinMatches, setFavouriteTagMinMatches } = useSettingsStore()
  const { getFavouriteTags, removeFavouriteTag, syncFavouriteTags } = useFavouriteTags()
  const [source, setSource] = useState('hcomic')
  const [tags, setTags] = useState<TagItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<string | null>(null)
  const [syncedCount, setSyncedCount] = useState<number | null>(null)
  const [confirmTag, setConfirmTag] = useState<string | null>(null)
  const [showAllTags, setShowAllTags] = useState(false)

  const loadTags = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = await getFavouriteTags(source)
      setTags(result.tags)
    } catch {
      setTags([])
    } finally {
      setIsLoading(false)
    }
  }, [getFavouriteTags, source])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTags()
  }, [loadTags])

  const handleSync = async () => {
    setIsSyncing(true)
    setSyncedCount(null)
    setSyncProgress('正在同步...')
    try {
      const result = await syncFavouriteTags(source)
      setSyncedCount(result.totalComics)
      setTags(result.tags)
      setSyncProgress(null)
    } catch {
      setSyncedCount(null)
      setSyncProgress(null)
    } finally {
      setIsSyncing(false)
    }
  }

  const handleRemoveTag = async (tag: string) => {
    try {
      await removeFavouriteTag(tag, source)
      setTags(prev => prev.filter(t => t.tag !== tag))
    } catch {
      // Ignore removal errors — user can retry
    }
    setConfirmTag(null)
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
        基于收藏夹中的漫画标签，推荐你可能感兴趣的内容。开启后，搜索结果中包含推荐标签的漫画会被高亮显示。
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

        <button
          onClick={handleSync}
          disabled={isSyncing}
          className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm
                     disabled:opacity-50 hover:bg-[var(--accent-hover)] transition-colors"
        >
          {isSyncing ? (syncProgress ?? '同步中...') : '从收藏夹同步标签'}
        </button>
        {syncedCount !== null && (
          <span className="text-sm text-[var(--text-secondary)]">
            已同步 {syncedCount} 本漫画
          </span>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-[var(--text-secondary)] py-4 text-center">加载中...</p>
      ) : tags.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)] py-4 text-center">请先同步收藏夹数据以生成推荐标签</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 max-h-52 overflow-y-auto content-start">
            {tags.slice(0, 10).map(({ tag, count }) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full
                           bg-amber-500/10 text-amber-600 text-sm"
              >
                {tag}
                <span className="text-xs opacity-60">({count})</span>
                <button
                  onClick={() => setConfirmTag(tag)}
                  className="w-4 h-4 rounded-full text-[10px] flex items-center justify-center
                             text-amber-600/60 hover:text-[var(--error)] hover:bg-[var(--error)]/10 transition-colors"
                  title="移除"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
          {tags.length > 10 && (
            <button
              onClick={() => setShowAllTags(true)}
              className="text-sm text-[var(--accent)] hover:underline"
            >
              管理全部标签 (共 {tags.length} 个)
            </button>
          )}
        </>
      )}

      {showAllTags && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={() => setShowAllTags(false)}>
          <div
            className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-lg max-w-lg w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-medium text-[var(--text-primary)]">
                全部推荐标签 ({SOURCE_LABELS[source as keyof typeof SOURCE_LABELS]})
              </h3>
              <button
                onClick={() => setShowAllTags(false)}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-lg leading-none"
              >
                ✕
              </button>
            </div>
            <div className="flex flex-wrap gap-2 max-h-[60vh] overflow-y-auto content-start">
              {tags.map(({ tag, count }) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full
                             bg-amber-500/10 text-amber-600 text-sm"
                >
                  {tag}
                  <span className="text-xs opacity-60">({count})</span>
                  <button
                    onClick={() => setConfirmTag(tag)}
                    className="w-4 h-4 rounded-full text-[10px] flex items-center justify-center
                               text-amber-600/60 hover:text-[var(--error)] hover:bg-[var(--error)]/10 transition-colors"
                    title="移除"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {confirmTag !== null && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={() => setConfirmTag(null)}>
          <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-lg max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium text-[var(--text-primary)] mb-4">
              移除推荐标签「{confirmTag}」？
            </h3>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              该标签将从推荐列表中移除，不影响收藏夹数据。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmTag(null)}
                className="px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)]"
              >
                取消
              </button>
              <button
                onClick={() => handleRemoveTag(confirmTag)}
                className="px-4 py-2 rounded-lg bg-[var(--error)] text-white hover:bg-[var(--error)]/80"
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
