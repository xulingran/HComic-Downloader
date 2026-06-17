import type { TagItem } from '../hooks/useTagPanel'
import { Modal } from './common/Modal'

interface TagDialogProps {
  open: boolean
  onClose: () => void
  loading: boolean
  refreshing: boolean
  filteredTags: TagItem[]
  selectedTags: string[]
  tagKeyword: string
  onTagKeywordChange: (kw: string) => void
  onToggleTag: (tag: string) => void
  onClearAllTags: () => void
  onRefreshTags: () => void
}

export function TagDialog({
  open, onClose,
  loading, refreshing,
  filteredTags, selectedTags,
  tagKeyword, onTagKeywordChange,
  onToggleTag, onClearAllTags, onRefreshTags,
}: TagDialogProps) {
  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      ariaLabel="选择标签"
      contentClassName="bg-[var(--bg-primary)] rounded-xl shadow-xl p-5 w-full mx-4 flex flex-col"
      contentStyle={{ maxWidth: 560, maxHeight: '80vh' }}
    >
      {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-[var(--text-primary)]">标签</h3>
            {selectedTags.length > 0 && (
              <span className="px-1.5 py-0.5 text-xs rounded-full bg-[var(--accent)] text-white min-w-[20px] text-center">
                {selectedTags.length}
              </span>
            )}
            {filteredTags.length > 0 && (
              <span className="text-xs text-[var(--text-secondary)]">
                ({filteredTags.length} 个标签)
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Toolbar: search + refresh */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 relative">
            <input
              type="text"
              value={tagKeyword}
              onChange={e => onTagKeywordChange(e.target.value)}
              placeholder="搜索标签..."
              className="w-full px-3 py-1.5 text-sm rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                         text-[var(--text-primary)] placeholder-[var(--text-secondary)] outline-none
                         focus:border-[var(--accent)]"
              autoFocus
            />
          </div>
          <button
            onClick={onRefreshTags}
            disabled={refreshing}
            className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)]
                       text-[var(--text-secondary)] hover:text-[var(--text-primary)]
                       hover:bg-[var(--bg-secondary)] disabled:opacity-50 transition-colors whitespace-nowrap"
            title="从站点全量同步标签"
          >
            {refreshing ? '同步中...' : '🔄 刷新'}
          </button>
        </div>

        {/* Tag cloud */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="text-center py-6 text-sm text-[var(--text-secondary)]">加载中...</div>
          ) : filteredTags.length === 0 ? (
            <div className="text-center py-6 text-sm text-[var(--text-secondary)]">
              暂无标签，请先搜索或点击刷新
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5 content-start">
              {filteredTags.map(({ tag, count }) => {
                const isSelected = selectedTags.includes(tag)
                return (
                  <button
                    key={tag}
                    onClick={() => onToggleTag(tag)}
                    className={`text-xs px-2.5 py-1 rounded-full cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-[var(--accent)] text-white'
                        : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--accent)]/20'
                    }`}
                  >
                    {tag}
                    <span className={`ml-1 text-[10px] ${isSelected ? 'text-white/70' : 'text-[var(--text-secondary)]'}`}>
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Selected tags bar */}
        {selectedTags.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[var(--border)]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-[var(--text-secondary)]">已选:</span>
              {selectedTags.map(tag => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-[var(--accent)] text-white"
                >
                  {tag}
                  <button
                    onClick={() => onToggleTag(tag)}
                    className="hover:text-white/70 transition-colors"
                  >
                    ×
                  </button>
                </span>
              ))}
              <button
                onClick={onClearAllTags}
                className="text-xs text-[var(--text-secondary)] hover:text-[var(--error)] ml-auto transition-colors"
              >
                清除全部
              </button>
            </div>
          </div>
        )}
    </Modal>
  )
}
