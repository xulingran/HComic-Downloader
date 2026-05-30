import { useState } from 'react'
import type { ChapterInfo } from '@shared/types'

interface Props {
  chapters: ChapterInfo[]
  open: boolean
  onConfirm: (chapterIds: string[]) => void
  onCancel: () => void
}

export function ChapterDownloadDialog({ chapters, open, onConfirm, onCancel }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  if (!open) return null

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const allSelected = chapters.length > 0 && selected.size === chapters.length
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(chapters.map((c) => c.id)))

  // 按 chapters 原顺序返回选中 id，保证下载顺序稳定
  const ordered = () => chapters.filter((c) => selected.has(c.id)).map((c) => c.id)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div
        role="dialog"
        aria-label="选择下载章节"
        className="bg-[var(--bg-primary)] rounded-xl shadow-xl p-5 max-w-md w-full mx-4 flex flex-col"
        style={{ maxHeight: '80vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">选择下载章节</h3>
          <button
            onClick={toggleAll}
            className="text-sm px-3 py-1 rounded-md bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors"
          >
            {allSelected ? '取消全选' : '全选'}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {chapters.map((c) => (
            <label
              key={c.id}
              className="flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer hover:bg-[var(--bg-secondary)] text-sm text-[var(--text-primary)]"
            >
              <input
                type="checkbox"
                aria-label={c.name}
                checked={selected.has(c.id)}
                onChange={() => toggle(c.id)}
                className="accent-[var(--accent)]"
              />
              <span className="flex-1 truncate">{c.name}</span>
              {c.pages ? <span className="text-xs text-[var(--text-secondary)]">{c.pages} 页</span> : null}
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            取消
          </button>
          <button
            disabled={selected.size === 0}
            onClick={() => onConfirm(ordered())}
            className="px-4 py-2 text-sm rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            下载选中
          </button>
        </div>
      </div>
    </div>
  )
}
