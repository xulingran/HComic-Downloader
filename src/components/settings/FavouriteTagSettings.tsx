import { useState, useEffect, useCallback } from 'react'
import { TAG_RECOMMENDATION_SOURCES, SOURCE_LABELS } from '@shared/types'
import { useFavouriteTags, useFavourites } from '../../hooks/useIpc'
import { useSettingsStore } from '../../stores/useSettingsStore'

interface TagItem {
  tag: string
  count: number
}

export function FavouriteTagSettings() {
  const { favouriteTagHighlight, setFavouriteTagHighlight } = useSettingsStore()
  const { getFavouriteTags, clearFavouriteTags, removeFavouriteTag } = useFavouriteTags()
  const { getFavourites } = useFavourites()
  const [source, setSource] = useState('hcomic')
  const [tags, setTags] = useState<TagItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<string | null>(null)
  const [syncedCount, setSyncedCount] = useState<number | null>(null)
  const [confirmTag, setConfirmTag] = useState<string | null>(null)

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
    setSyncProgress(null)
    try {
      await clearFavouriteTags(source)

      const first = await getFavourites(1, source)
      const totalPages = first.pagination?.totalPages ?? 1
      let total = first.comics.length
      setSyncProgress(`正在同步 1/${totalPages}...`)

      for (let page = 2; page <= totalPages; page++) {
        try {
          const result = await getFavourites(page, source)
          total += result.comics.length
          setSyncProgress(`正在同步 ${page}/${totalPages}...`)
        } catch {
          // Skip failed pages, continue
        }
      }

      setSyncedCount(total)
      setSyncProgress(null)
      await loadTags()
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
