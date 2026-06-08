import { PaginationInfo } from '@shared/types'
import { PaginationControls } from './common/PaginationControls'
import { BatchControls } from './common/BatchControls'
import { useSources, useSearchModes, useRankingOptions, useCopymangaCategories } from '../hooks/useSourceOptions'
import { sourceSupportsRanking } from '../utils/source'
import type { TagItem } from '../hooks/useTagPanel'


interface SearchBarProps {
  source: string
  onSourceChange: (val: string) => void
  mode: string
  onModeChange: (val: string) => void
  query: string
  onQueryChange: (val: string) => void
  isLoading: boolean
  onSearch: () => void
  onRandom: () => void
  showRandom: boolean
  showHistory: boolean
  onShowHistoryChange: (show: boolean) => void
  history: string[]
  onClearHistory: () => void
  onRemoveHistory: (term: string) => void
  onSelectHistory: (term: string) => void
  inputRef: React.RefObject<HTMLInputElement>
  historyDropdownRef: React.RefObject<HTMLDivElement>
  hasFilterEnabled: boolean
  onFilterToggle: () => void
  hasBlacklistedTags: boolean
  pagination: PaginationInfo | null
  blockedCount: number
  hasComics: boolean
  batchMode: boolean
  selectedCount: number
  onToggleBatchMode: (val: boolean) => void
  onSelectAll: () => void
  onClearSelection: () => void
  onBatchDownload: () => void
  onPageJump: () => void
  onPageNavigate: (page: number) => void
  // Tag panel props
  showTagPanel: boolean
  tagPanelExpanded: boolean
  onTagPanelToggle: () => void
  tagPanelLoading: boolean
  tagPanelRefreshing: boolean
  filteredTags: TagItem[]
  selectedTags: string[]
  tagKeyword: string
  onTagKeywordChange: (kw: string) => void
  onToggleTag: (tag: string) => void
  onClearAllTags: () => void
  onRefreshTags: () => void
}

export function SearchBar({
  source, onSourceChange, mode, onModeChange,
  query, onQueryChange,
  isLoading, onSearch, onRandom, showRandom,
  showHistory, onShowHistoryChange,
  history, onClearHistory, onRemoveHistory, onSelectHistory,
  inputRef, historyDropdownRef,
  hasFilterEnabled, onFilterToggle, hasBlacklistedTags,
  pagination, blockedCount, hasComics,
  batchMode, selectedCount, onToggleBatchMode, onSelectAll, onClearSelection, onBatchDownload,
  onPageJump, onPageNavigate,
  // Tag panel
  showTagPanel, tagPanelExpanded, onTagPanelToggle,
  tagPanelLoading, tagPanelRefreshing,
  filteredTags, selectedTags, tagKeyword, onTagKeywordChange,
  onToggleTag, onClearAllTags, onRefreshTags,
}: SearchBarProps) {
  const sources = useSources()
  const searchModes = useSearchModes()
  const rankingOptions = useRankingOptions()
  const copymangaCategories = useCopymangaCategories()
  const isCopymangaCategory = mode === 'ranking' && source === 'copymanga'
  return (
    <div className="bg-[var(--bg-primary)] rounded-xl p-3 shadow-sm">
      <div className="flex gap-3">
        <select
          value={source}
          onChange={(e) => onSourceChange(e.target.value)}
          className="px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                     text-[var(--text-primary)] text-sm"
        >
          {sources.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>

        <div className="flex-1 relative flex items-center rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                    focus-within:border-[var(--accent)]">
          <div className="relative shrink-0 flex items-center border-r border-[var(--border)]">
            <select
              value={mode}
              onChange={(e) => onModeChange(e.target.value)}
              className="appearance-none bg-transparent text-[var(--text-primary)] text-sm
                         pl-3 pr-5 py-2 outline-none cursor-pointer"
            >
              {searchModes.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <svg
              className="absolute right-1.5 w-3 h-3 pointer-events-none text-[var(--text-secondary)]"
              viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"
            >
              <path d="M2 4l4 4 4-4" />
            </svg>
          </div>
          {mode === 'ranking' && sourceSupportsRanking(source) && !isCopymangaCategory ? (
            <select
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              className="flex-1 bg-transparent border-none py-2 pl-3 pr-4 text-[var(--text-primary)]
                         text-sm outline-none cursor-pointer"
            >
              <option value="">选择排行</option>
              {rankingOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          ) : isCopymangaCategory ? (
            <select
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              className="flex-1 bg-transparent border-none py-2 pl-3 pr-4 text-[var(--text-primary)]
                         text-sm outline-none cursor-pointer"
            >
              {copymangaCategories.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          ) : (
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onFocus={() => { if (history.length > 0) onShowHistoryChange(true) }}
              onKeyDown={(e) => e.key === 'Enter' && onSearch()}
              placeholder="输入搜索内容..."
              className="flex-1 bg-transparent border-none py-2 pl-3 pr-4 text-[var(--text-primary)]
                         text-sm placeholder-[var(--text-secondary)] outline-none"
            />
          )}
          {showHistory && history.length > 0 && (
            <div ref={historyDropdownRef} className="absolute top-full left-0 right-0 mt-1 bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg shadow-lg z-10 max-h-64 overflow-y-auto">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--border)]">
                <span className="text-xs text-[var(--text-secondary)]">搜索历史</span>
                <button onClick={() => { onClearHistory(); onShowHistoryChange(false) }} className="text-xs text-[var(--text-secondary)] hover:text-[var(--error)]">清空</button>
              </div>
              {history.map((term) => (
                <div key={term} className="flex items-center justify-between px-3 py-2 hover:bg-[var(--bg-secondary)] cursor-pointer" onMouseDown={() => { onSelectHistory(term); onShowHistoryChange(false) }}>
                  <span className="text-sm text-[var(--text-primary)] truncate">{term}</span>
                  <button onClick={(e) => { e.stopPropagation(); onRemoveHistory(term) }} className="text-xs text-[var(--text-secondary)] hover:text-[var(--error)] ml-2 flex-shrink-0">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {showRandom && (
          <button
            onClick={onRandom}
            disabled={isLoading}
            className="px-4 py-2 rounded-lg border border-[var(--border)]
                       text-[var(--text-primary)] bg-[var(--bg-secondary)]
                       hover:bg-[var(--bg-primary)] disabled:opacity-50 transition-colors"
          >
            🎲 随机
          </button>
        )}

        <button
          onClick={() => onSearch()}
          disabled={isLoading}
          className="px-6 py-2 bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)]
                     disabled:opacity-50 transition-colors"
        >
          {isLoading ? '搜索中...' : '搜索'}
        </button>
      </div>

      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--text-secondary)]">
            源: {sources.find(s => s.value === source)?.label}
            {pagination && pagination.totalItems > 0 && ` | 共 ${pagination.totalItems} 条结果`}
            {blockedCount > 0 && ` | 已过滤 ${blockedCount} 条结果`}
          </span>
          {hasBlacklistedTags && hasComics && (
            <>
              <span className="text-[var(--border)]">|</span>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasFilterEnabled}
                  onChange={onFilterToggle}
                  className="rounded"
                />
                <span className={hasFilterEnabled ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}>
                  过滤
                </span>
              </label>
            </>
          )}
          {hasComics && <BatchControls
            batchMode={batchMode}
            selectedCount={selectedCount}
            onToggleBatchMode={onToggleBatchMode}
            onSelectAll={onSelectAll}
            onClearSelection={onClearSelection}
            onBatchDownload={onBatchDownload}
          />}
        </div>
        {pagination && pagination.totalPages > 1 && (
          <PaginationControls
            currentPage={pagination.currentPage}
            totalPages={pagination.totalPages}
            onNavigate={onPageNavigate}
            onJumpClick={onPageJump}
          />
        )}
      </div>

      {/* Tag panel section (collapsed header + expandable content) */}
      {showTagPanel && (
        <>
          {/* Collapsed header */}
          <button
            onClick={onTagPanelToggle}
            className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-[var(--bg-secondary)] transition-colors rounded-lg mt-1"
          >
            <div className="flex items-center gap-2">
              <span className="text-[var(--text-primary)]">标签</span>
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
            <svg
              className={`w-4 h-4 text-[var(--text-secondary)] transition-transform ${tagPanelExpanded ? 'rotate-180' : ''}`}
              viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
            >
              <path d="M4 6l4 4 4-4" />
            </svg>
          </button>

          {/* Expanded content */}
          {tagPanelExpanded && (
            <div className="border-t border-[var(--border)] px-3 py-3">
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
                  />
                </div>
                <button
                  onClick={onRefreshTags}
                  disabled={tagPanelRefreshing}
                  className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)]
                             text-[var(--text-secondary)] hover:text-[var(--text-primary)]
                             hover:bg-[var(--bg-secondary)] disabled:opacity-50 transition-colors whitespace-nowrap"
                  title="从站点全量同步标签"
                >
                  {tagPanelRefreshing ? '同步中...' : '🔄 刷新'}
                </button>
              </div>

              {/* Tag cloud */}
              {tagPanelLoading ? (
                <div className="text-center py-6 text-sm text-[var(--text-secondary)]">加载中...</div>
              ) : filteredTags.length === 0 ? (
                <div className="text-center py-6 text-sm text-[var(--text-secondary)]">
                  暂无标签，请先搜索或点击刷新
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5 max-h-60 overflow-y-auto content-start">
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
            </div>
          )}
        </>
      )}
    </div>
  )
}
