import { useState, useRef } from 'react'
import type { DuplicateGroup as DuplicateGroupType } from '@/utils/titleSimilarity'
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

interface DuplicateGroupProps {
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

export function DuplicateGroup({
  groupIndex,
  group,
  initialExpanded = true,
  ignored = false,
  onIgnore,
  onUnignore,
}: DuplicateGroupProps) {
  const [expanded, setExpanded] = useState(initialExpanded)
  const openDrawer = useDrawerStore(s => s.openDrawer)
  const openReader = useReaderStore(s => s.openReader)

  return (
    <div className="bg-[var(--bg-primary)] rounded-xl shadow-sm overflow-hidden">
      <div className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--bg-secondary)] transition-colors text-left">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex-1 flex items-center justify-between text-left"
        >
          <span className="text-sm font-medium text-[var(--text-primary)]">
            疑似重复组 {groupIndex + 1}（{group.comics.length} 本）
            {ignored && <span className="ml-2 text-xs text-[var(--text-secondary)]">· 已忽略</span>}
          </span>
          <span className="text-[var(--text-secondary)] text-xs">
            {expanded ? '▲' : '▼'}
          </span>
        </button>
        {ignored ? (
          <button
            onClick={onUnignore}
            className="ml-3 flex-shrink-0 px-2 py-1 text-xs rounded
                       bg-[var(--bg-secondary)] text-[var(--text-primary)]
                       hover:bg-[var(--accent)] hover:text-white transition-colors"
            title="取消忽略"
          >
            取消忽略
          </button>
        ) : (
          <button
            onClick={onIgnore}
            className="ml-3 flex-shrink-0 px-2 py-1 text-xs rounded
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
              <span className="text-xs text-[var(--text-secondary)] flex-shrink-0">
                {Math.round((group.scores.get(comic.id) ?? 0) * 100)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
