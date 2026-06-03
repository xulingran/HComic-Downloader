import { useState } from 'react'
import type { DuplicateGroup as DuplicateGroupType } from '@/utils/titleSimilarity'
import { useDrawerStore } from '@/stores/useDrawerStore'
import { useReaderStore } from '@/stores/useReaderStore'

interface ComicCoverProps {
  src: string
  onClick: () => void
}

function ComicCover({ src, onClick }: ComicCoverProps) {
  const [hidden, setHidden] = useState(false)
  if (hidden) return null
  return (
    <button
      onClick={onClick}
      className="flex-shrink-0 cursor-pointer"
      title="预览漫画"
    >
      <img
        src={src}
        alt=""
        className="w-10 h-14 object-cover rounded bg-[var(--bg-secondary)]"
        onError={() => setHidden(true)}
      />
    </button>
  )
}

interface DuplicateGroupProps {
  groupIndex: number
  group: DuplicateGroupType
}

export function DuplicateGroup({ groupIndex, group }: DuplicateGroupProps) {
  const [expanded, setExpanded] = useState(true)
  const openDrawer = useDrawerStore(s => s.openDrawer)
  const openReader = useReaderStore(s => s.openReader)

  return (
    <div className="bg-[var(--bg-primary)] rounded-xl shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3
                   hover:bg-[var(--bg-secondary)] transition-colors text-left"
      >
        <span className="text-sm font-medium text-[var(--text-primary)]">
          疑似重复组 {groupIndex + 1}（{group.comics.length} 本）
        </span>
        <span className="text-[var(--text-secondary)] text-xs">
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-[var(--border)] divide-y divide-[var(--border)]">
          {group.comics.map(comic => (
            <div
              key={comic.id}
              className="w-full flex items-center gap-3 px-4 py-2
                         hover:bg-[var(--bg-secondary)] transition-colors"
            >
              <ComicCover src={comic.coverUrl} onClick={() => openReader(comic)} />
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
