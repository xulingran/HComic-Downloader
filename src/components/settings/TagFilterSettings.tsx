import { useState } from 'react'
import type { TagBlacklist } from '@shared/types'

interface TagFilterSettingsProps {
  tagBlacklist: TagBlacklist
  addTag: (source: string, tag: string) => void
  removeTag: (source: string, tag: string) => void
}

const SOURCES = [
  { key: 'hcomic' as const, label: 'HComic' },
  { key: 'moeimg' as const, label: 'Moeimg' },
  { key: 'jmcomic' as const, label: 'JMComic' },
  { key: 'bika' as const, label: 'Bika' },
]

export function TagFilterSettings({ tagBlacklist, addTag, removeTag }: TagFilterSettingsProps) {
  const [activeSource, setActiveSource] = useState<keyof TagBlacklist>('hcomic')
  const [inputValue, setInputValue] = useState('')
  const [confirmTag, setConfirmTag] = useState<string | null>(null)

  const tags = tagBlacklist[activeSource]

  const handleAdd = () => {
    const trimmed = inputValue.trim()
    if (!trimmed) return
    addTag(activeSource, trimmed)
    setInputValue('')
  }

  const handleRemove = (tag: string) => {
    removeTag(activeSource, tag)
    setConfirmTag(null)
  }

  return (
    <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm space-y-6">
      <h3 className="text-base font-medium text-[var(--text-primary)] border-b border-[var(--border)] pb-3">
        标签过滤
      </h3>

      <div>
        <div className="flex gap-3 mb-4">
          {SOURCES.map((s) => (
            <button
              key={s.key}
              onClick={() => setActiveSource(s.key)}
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                activeSource === s.key
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]'
              }`}
            >
              {s.label}
              {tagBlacklist[s.key].length > 0 && (
                <span className="ml-1.5 text-xs opacity-80">({tagBlacklist[s.key].length})</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
            placeholder="输入标签名..."
            className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                       text-[var(--text-primary)] text-sm placeholder-[var(--text-secondary)]
                       focus:outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={handleAdd}
            disabled={!inputValue.trim()}
            className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm
                       disabled:opacity-50 hover:bg-[var(--accent-hover)] transition-colors"
          >
            添加
          </button>
        </div>

        {tags.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)] py-4 text-center">暂无屏蔽标签</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full
                           bg-[var(--bg-secondary)] text-sm text-[var(--text-primary)]"
              >
                {tag}
                <button
                  onClick={() => setConfirmTag(tag)}
                  className="w-4 h-4 rounded-full text-[10px] flex items-center justify-center
                             text-[var(--text-secondary)] hover:text-[var(--error)] hover:bg-[var(--error)]/10 transition-colors"
                  title="移除"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {confirmTag !== null && (
        <ConfirmDialog
          key={confirmTag}
          tag={confirmTag}
          onCancel={() => setConfirmTag(null)}
          onConfirm={(tag) => handleRemove(tag)}
        />
      )}
    </div>
  )
}

function ConfirmDialog({ tag, onCancel, onConfirm }: { tag: string; onCancel: () => void; onConfirm: (tag: string) => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={onCancel}>
      <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-lg max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-medium text-[var(--text-primary)] mb-4">
          移除屏蔽标签「{tag}」？
        </h3>
        <p className="text-sm text-[var(--text-secondary)] mb-4">
          包含该标签的漫画将恢复显示在搜索结果中。
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)]"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(tag)}
            className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
          >
            确认
          </button>
        </div>
      </div>
    </div>
  )
}
