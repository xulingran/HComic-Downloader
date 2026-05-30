import type { ChapterInfo } from '@shared/types'

interface ChapterPickerProps {
  chapters: ChapterInfo[]
  onSelect: (chapterId: string) => void
  title?: string
}

export function ChapterPicker({ chapters, onSelect, title }: ChapterPickerProps) {
  return (
    <div className="flex flex-col flex-1 overflow-y-auto px-5 py-6" role="list" aria-label="章节列表">
      <p className="text-sm text-gray-400 mb-4 text-center">
        {title ? `${title} · ` : ''}请选择章节 · 共 {chapters.length} 章
      </p>
      <div className="grid gap-2 max-w-xl w-full mx-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
        {chapters.map((c) => (
          <button
            key={c.id}
            role="listitem"
            onClick={() => onSelect(c.id)}
            className="px-3 py-2.5 rounded-md text-sm text-white text-left transition-colors hover:bg-white/15"
            style={{ background: 'rgba(255,255,255,0.08)' }}
          >
            <span className="block truncate">{c.name}</span>
            {c.pages ? <span className="block text-xs text-gray-500">{c.pages} 页</span> : null}
          </button>
        ))}
      </div>
    </div>
  )
}
