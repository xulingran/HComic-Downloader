import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useTagList } from '../hooks/useIpc'
import type { TagItem } from '../hooks/useTagPanel'
import { tagItemVariants, tagListVariants, useReducedMotionPreference } from '../lib/anim'

interface NhEntryGridProps {
  onLatest: () => void
  onPopular: () => void
  onSelectTag: (tag: string) => void
}

/** 头部档位阈值：按热度降序的前 N₁ 个标签。固定常量，不随标签总数变化。 */
const TIER_HEAD = 5
/** 中段档位阈值：紧随头部之后的 N₂ 个标签。固定常量。 */
const TIER_MID = 5

/** 标签热度档位：决定视觉权重（底色 / 字号 / 计数样式）。 */
type TagTier = 'head' | 'mid' | 'tail'

/**
 * 按索引判定标签所属档位。
 *
 * - `allCountsZero` 为真时（标签全部无 count），统一返回 'tail'，
 *   用中性样式单组渲染，避免无意义的档位区分。
 * - 否则按固定索引分档：前 TIER_HEAD 个 → head，其后 TIER_MID 个 → mid，其余 → tail。
 * - 当 `total <= TIER_HEAD` 时全部归入 head，保证少量标签时视觉权重不致过弱。
 *
 * @returns 档位；当 `index >= total` 时返回 null（理论上不应发生，防御性返回）。
 */
export function classifyTier(index: number, total: number, allCountsZero: boolean): TagTier | null {
  if (index < 0 || index >= total) return null
  if (allCountsZero) return 'tail'
  if (total <= TIER_HEAD) return 'head'
  if (index < TIER_HEAD) return 'head'
  if (index < TIER_HEAD + TIER_MID) return 'mid'
  return 'tail'
}

/** 档位 → 样式映射：wrapper 控制标签主体底色/字号，badge 控制计数展示形式。 */
const TIER_STYLE: Record<TagTier, { wrapper: string; badge: string }> = {
  head: {
    wrapper:
      'bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)]',
    badge: 'ml-1.5 bg-white/20 rounded-full px-1.5 text-xs font-semibold',
  },
  mid: {
    wrapper:
      'bg-[var(--accent)]/10 text-[var(--accent)] text-sm hover:bg-[var(--accent)]/20',
    badge: 'ml-1.5 text-xs font-medium text-[var(--accent)]/70',
  },
  tail: {
    wrapper:
      'bg-[var(--bg-secondary)] text-[var(--text-primary)] text-xs hover:bg-[var(--accent)]/15',
    badge: 'ml-1 text-[10px] text-[var(--text-secondary)]',
  },
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
  // 刷新计数器：递增后作为档位容器 key，使 framer-motion 视为新元素重新触发 stagger 进场。
  const [refreshKey, setRefreshKey] = useState(0)
  const reduceMotion = useReducedMotionPreference()

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
    setRefreshKey((k) => k + 1)
  }, [loadTags])

  // 按档位分组：count 全零或总数 ≤ 头部阈值时合并为单一 tail/head 组。
  const allCountsZero = tags.length > 0 && tags.every((t) => !t.count || t.count === 0)
  const groups: { tier: TagTier; items: TagItem[] }[] = []
  if (tags.length > 0) {
    if (allCountsZero) {
      groups.push({ tier: 'tail', items: tags })
    } else {
      const head = tags.slice(0, TIER_HEAD)
      const mid = tags.slice(TIER_HEAD, TIER_HEAD + TIER_MID)
      const tail = tags.slice(TIER_HEAD + TIER_MID)
      if (head.length > 0) groups.push({ tier: 'head', items: head })
      if (mid.length > 0) groups.push({ tier: 'mid', items: mid })
      if (tail.length > 0) groups.push({ tier: 'tail', items: tail })
    }
  }

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
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">🔥 热门标签</h3>
            {tags.length > 0 && (
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                按热度排序 · 共 {tags.length} 个
              </p>
            )}
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
        ) : groups.length > 0 ? (
          <div className="space-y-3" key={refreshKey}>
            {groups.map(({ tier, items }) => {
              const style = TIER_STYLE[tier]
              const Wrapper = reduceMotion ? 'div' : motion.div
              const wrapperProps = reduceMotion ? {} : { variants: tagListVariants, initial: 'hidden' as const, animate: 'show' as const }
              return (
                <Wrapper key={tier} className="flex flex-wrap gap-2" {...wrapperProps}>
                  {items.map(({ tag, count }) => {
                    const Button = reduceMotion ? 'button' : motion.button
                    const buttonProps = reduceMotion ? {} : { variants: tagItemVariants }
                    return (
                      <Button
                        key={tag}
                        onClick={() => onSelectTag(tag)}
                        className={`px-2.5 py-1 rounded-full transition-colors ${style.wrapper}`}
                        {...buttonProps}
                      >
                        {tag}
                        {count > 0 && <span className={style.badge}>{formatCount(count)}</span>}
                      </Button>
                    )
                  })}
                </Wrapper>
              )
            })}
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
