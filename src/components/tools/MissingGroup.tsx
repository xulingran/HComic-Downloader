import { useState, useRef, useMemo } from 'react'
import type { DuplicateGroup as DuplicateGroupType } from '@/utils/titleSimilarity'
import { extractAlbumTitle } from '@/utils/titleSimilarity'
import { useDrawerStore } from '@/stores/useDrawerStore'
import { useReaderStore } from '@/stores/useReaderStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useCoverImage } from '@/hooks/useCoverImage'

interface ComicCoverProps {
  coverUrl: string
  onClick: () => void
}

function ComicCover({ coverUrl, onClick }: ComicCoverProps) {
  const sfwMode = useSettingsStore(s => s.sfwMode)
  const containerRef = useRef<HTMLButtonElement>(null)
  // sfwMode 作为 disabled：开启 SFW 模式时不发起封面请求
  const { coverSrc } = useCoverImage(coverUrl, containerRef, sfwMode)

  return (
    <button
      ref={containerRef}
      onClick={onClick}
      className="flex-shrink-0 cursor-pointer"
      title="预览漫画"
    >
      {sfwMode ? (
        <div className="w-10 h-14 rounded bg-[var(--bg-secondary)]
                        flex items-center justify-center text-[var(--text-secondary)]">
          <span className="text-lg">📖</span>
        </div>
      ) : coverSrc ? (
        <img
          src={coverSrc}
          alt=""
          className="w-10 h-14 object-cover rounded bg-[var(--bg-secondary)]"
        />
      ) : (
        <div className="w-10 h-14 rounded bg-[var(--bg-secondary)]
                        flex items-center justify-center text-[var(--text-secondary)]">
          <span className="text-lg">📖</span>
        </div>
      )}
    </button>
  )
}

/**
 * 清洗系列名作为搜索词。
 *
 * extractAlbumTitle 求的是组内标题的 token 交集，会保留所有成员共有的方括号
 * 标记（如 `[中国翻訳]` `[DL版]` `[汉化]`），这些是版本/翻译噪声，带进搜索
 * 词会严重降低搜索质量。本函数剥离这类标记，保留作品名主体。
 *
 * 同时剥离行尾序号标记（搜索时不需要序号）。
 *
 * 覆盖的标记形态：
 *   - 半角方括号 [...] 与全角方括号 【...】（版本/翻译/作者前缀/区间包裹）
 *   - 英文标签 LEVEL:N / STAGE N / Vol.N / EP.N / Chapter N / PART.N / ACT N
 *   - 中文 第N话/卷/章/弾（含区间 第1-5话）
 *   - 井号 #N
 *   - 日文 其のN
 *   - 行尾裸数字（如 "...振り回されてます5"）—— 仅在剥离其他标记后仍残留时
 *     剥离末尾连续数字，避免破坏作品名内的合法数字
 */
function cleanSeriesNameForSearch(raw: string): string {
  let s = raw
  // 剥离所有方括号标记（半角 [...] 与全角 【...】，版本/翻译/作者前缀/区间包裹）
  // 反复迭代以处理嵌套或连续多个标记
  let prev = ''
  let guard = 0
  while (prev !== s && guard < 10) {
    prev = s
    s = s.replace(/\[[^\]]*\]/g, '').replace(/【[^】]*】/g, '')
    guard++
  }
  // 剥离行尾序号标记：LEVEL:N / 第N话 / #N / Vol.N / EP.N 等
  s = s.replace(/\s*(LEVEL|Level|level|STAGE|Stage|stage|PHASE|Phase|phase|PART|Part|part|ACT|Act|act|Vol|vol|VOL|EP|ep|Chapter|chapter|CHAPTER)\.?[\s:]?\d+(-\d+)?\s*[话話卷巻章弾]?\s*$/i, '')
  s = s.replace(/\s*第?\s*\d+(-\d+)?\s*[话話卷巻章弾]\s*$/i, '')
  s = s.replace(/\s*#\s*\d+\s*$/i, '')
  s = s.replace(/\s*其[の之]\s*\d+\s*$/i, '')
  // 剥离行尾裸数字（如 "...振り回されてます5"）：仅剥离末尾紧贴的纯数字，
  // 避免误伤作品名中间的数字。要求数字前是非数字字符或行首。
  s = s.replace(/(?<=\D)\d+\s*$/, '')
  return s.trim()
}

/**
 * 从组内标题提取并清洗搜索词。
 *
 * 优先级递减策略（确保按钮尽量可用，而非轻易 disabled）：
 *   1. extractAlbumTitle 提取组内共有字段（最理想，如"作品"去掉"第N话"）
 *   2. 失败 → 取组内成员标题清洗后最长的那个（用任一成员也能搜到该系列）
 *   3. 都 < 2 字符 → 返回 null（极少见，按钮禁用）
 *
 * 清洗：剥离方括号版本/翻译标记（[中国翻訳] [DL版] [汉化] 等）+ 行尾序号
 * 标记（LEVEL:N / 第N话 / #N / Vol.N / 其のN），保留作品名主体。
 */
function extractSearchQuery(titles: string[]): string | null {
  const candidates: string[] = []

  // 优先级 1：extractAlbumTitle 共有字段
  const shared = extractAlbumTitle(titles)
  if (shared) candidates.push(cleanSeriesNameForSearch(shared))

  // 优先级 2：每个成员标题清洗后的结果（取最长的，通常含最多作品名信息）
  for (const t of titles) {
    const cleaned = cleanSeriesNameForSearch(t)
    if (cleaned) candidates.push(cleaned)
  }

  // 从候选里选最长的（信息量最大），长度 ≥ 2 才合格
  let best: string | null = null
  for (const c of candidates) {
    if (c.length >= 2 && (!best || c.length > best.length)) {
      best = c
    }
  }
  return best
}

interface MissingGroupProps {
  groupIndex: number
  group: DuplicateGroupType
  /** 初始展开状态，默认 true（active 组），ignored 组传 false */
  initialExpanded?: boolean
  /** 是否为已忽略组（影响头部按钮：取消忽略 vs 忽略此组） */
  ignored?: boolean
  /** active 组的"忽略此组"回调 */
  onIgnore?: () => void
  /** ignored 组的"取消忽略"回调 */
  onUnignore?: () => void
}

/**
 * 单组渲染：展示同系列组的成员，提供"搜索此系列"入口与"忽略此组"操作。
 *
 * 与 DuplicateGroup 的差异（design.md 决策 4）：
 *   - 头部带"搜索此系列"按钮（查缺补漏特有）
 *   - 头部带"忽略此组/取消忽略"按钮（照搬重复检测的黑名单范式）
 *   - 不展示相似度百分比（语义无关）
 *
 * 搜索词来源（用户决策）：extractAlbumTitle 提取组内共有字段，
 * 经 cleanSeriesNameForSearch 剥离版本/序号标记后作为搜索词。
 * 提取失败或清洗后为空时，按钮禁用。
 */
export function MissingGroup({
  groupIndex,
  group,
  initialExpanded = true,
  ignored = false,
  onIgnore,
  onUnignore,
}: MissingGroupProps) {
  const [expanded, setExpanded] = useState(initialExpanded)
  const openDrawer = useDrawerStore(s => s.openDrawer)
  const openReader = useReaderStore(s => s.openReader)
  const setPendingSearch = useDrawerStore(s => s.setPendingSearch)

  // 提取并清洗系列名作为搜索词（memoized：组成员不变则不变）
  // 使用带回退的提取策略，确保按钮尽量可用
  const searchQuery = useMemo(() => {
    const titles = group.comics.map(c => c.title)
    return extractSearchQuery(titles)
  }, [group.comics])

  const handleSearchSeries = () => {
    if (!searchQuery) return
    // 复用 ComicInfoDrawer 的先例：setPendingSearch 触发 App 自动跳搜索页
    setPendingSearch(searchQuery, 'keyword')
  }

  return (
    <div className="bg-[var(--bg-primary)] rounded-xl shadow-sm overflow-hidden">
      <div className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--bg-secondary)] transition-colors text-left">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex-1 flex items-center justify-between text-left"
        >
          <span className="text-sm font-medium text-[var(--text-primary)]">
            同系列组 {groupIndex + 1}（{group.comics.length} 本）
            {ignored && <span className="ml-2 text-xs text-[var(--text-secondary)]">· 已忽略</span>}
          </span>
          <span className="text-[var(--text-secondary)] text-xs">
            {expanded ? '▲' : '▼'}
          </span>
        </button>
        <button
          onClick={handleSearchSeries}
          disabled={!searchQuery}
          className="ml-3 flex-shrink-0 px-2 py-1 text-xs rounded
                     bg-[var(--bg-secondary)] text-[var(--text-primary)]
                     hover:bg-[var(--accent)] hover:text-white transition-colors
                     disabled:opacity-40 disabled:cursor-not-allowed"
          title={searchQuery ? `搜索「${searchQuery}」` : '无法提取系列名'}
        >
          🔍 搜索此系列
        </button>
        {ignored ? (
          <button
            onClick={onUnignore}
            className="ml-2 flex-shrink-0 px-2 py-1 text-xs rounded
                       bg-[var(--bg-secondary)] text-[var(--text-primary)]
                       hover:bg-[var(--accent)] hover:text-white transition-colors"
            title="取消忽略"
          >
            取消忽略
          </button>
        ) : (
          <button
            onClick={onIgnore}
            className="ml-2 flex-shrink-0 px-2 py-1 text-xs rounded
                       bg-[var(--bg-secondary)] text-[var(--text-primary)]
                       hover:bg-[var(--accent)] hover:text-white transition-colors"
            title="将此组加入已忽略"
          >
            忽略此组
          </button>
        )}
      </div>

      {expanded && (
        <div className="border-t border-[var(--border)] divide-y divide-[var(--border)]">
          {group.comics.map(comic => (
            <div
              key={comic.id}
              className="w-full flex items-center gap-3 px-4 py-2
                         hover:bg-[var(--bg-secondary)] transition-colors"
            >
              <ComicCover coverUrl={comic.coverUrl} onClick={() => openReader(comic)} />
              <button
                onClick={() => openDrawer(comic)}
                className="flex-1 text-sm text-[var(--text-primary)] break-all text-left cursor-pointer"
                title="查看详情"
              >
                {comic.title}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
