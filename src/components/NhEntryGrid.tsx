import { useCallback, useEffect, useState } from 'react'
import { useTagList } from '../hooks/useIpc'
import type { TagItem } from '../hooks/useTagPanel'

interface NhEntryGridProps {
  onLatest: () => void
  onPopular: () => void
  onSelectTag: (tag: string) => void
}

function formatCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}m`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return String(count)
}

export function NhEntryGrid({ onLatest, onPopular, onSelectTag }: NhEntryGridProps) {
  const { getTagList } = useTagList()
  const [tags, setTags] = useState<TagItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadTags = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getTagList('nh', '', 1, 24, 'popular')
      setTags(result.tags)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载标签失败')
    } finally {
      setLoading(false)
    }
  }, [getTagList])

  useEffect(() => {
    void Promise.resolve().then(loadTags)
  }, [loadTags])

  const handleRefresh = useCallback(async () => {
    await loadTags()
  }, [loadTags])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <button
          onClick={onLatest}
          className="group relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-5 text-left shadow-sm
                     hover:border-[var(--accent)] transition-colors"
        >
          <div className="text-xs uppercase tracking-[0.3em] text-[var(--text-secondary)]">Latest</div>
          <div className="mt-2 text-xl font-semibold text-[var(--text-primary)]">最近更新</div>
          <div className="mt-2 text-sm text-[var(--text-secondary)]">按发布时间浏览 NH 最新内容</div>
          <div className="mt-4 text-sm text-[var(--accent)] group-hover:translate-x-1 transition-transform">进入 →</div>
        </button>

        <button
          onClick={onPopular}
          className="group relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-5 text-left shadow-sm
                     hover:border-[var(--accent)] transition-colors"
        >
          <div className="text-xs uppercase tracking-[0.3em] text-[var(--text-secondary)]">Popular</div>
          <div className="mt-2 text-xl font-semibold text-[var(--text-primary)]">热门排行</div>
          <div className="mt-2 text-sm text-[var(--text-secondary)]">按 popular 排序浏览当前热门内容</div>
          <div className="mt-4 text-sm text-[var(--accent)] group-hover:translate-x-1 transition-transform">进入 →</div>
        </button>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">热门标签</h3>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">来自 NH 原始标签目录</p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] text-[var(--text-secondary)]
                       hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50 transition-colors"
          >
            {loading ? '刷新中...' : '刷新热门标签'}
          </button>
        </div>

        {loading ? (
          <div className="py-6 text-center text-sm text-[var(--text-secondary)]">加载标签中...</div>
        ) : tags.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {tags.map(({ tag, count }) => (
              <button
                key={tag}
                onClick={() => onSelectTag(tag)}
                className="px-2.5 py-1 text-xs rounded-full bg-[var(--bg-secondary)] text-[var(--text-primary)]
                           hover:bg-[var(--accent)]/20 transition-colors"
              >
                {tag}
                {count > 0 && <span className="ml-1 text-[10px] text-[var(--text-secondary)]">{formatCount(count)}</span>}
              </button>
            ))}
          </div>
        ) : (
          <div className="py-6 text-center">
            <div className="text-sm text-[var(--text-secondary)]">暂无标签数据，请先点击刷新热门标签</div>
            {error && <div className="mt-2 text-xs text-[var(--error)]">{error}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
