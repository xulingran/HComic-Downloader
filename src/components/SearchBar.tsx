import { PaginationInfo } from '@shared/types'
import { PaginationControls } from './common/PaginationControls'
import { BatchControls } from './common/BatchControls'
import { useSources, useSearchModes, useRankingOptions, useCopymangaCategories, useBikaLeaderboardOptions, useNhRankingOptions } from '../hooks/useSourceOptions'
import { sourceSupportsRanking } from '../utils/source'


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
  onBatchDownloadAsAlbum?: () => void
  onPageJump: () => void
  onPageNavigate: (page: number) => void
  // Tag panel props
  showTagPanel: boolean
  onTagPanelToggle: () => void
  selectedTags: string[]
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
  batchMode, selectedCount, onToggleBatchMode, onSelectAll, onClearSelection, onBatchDownload, onBatchDownloadAsAlbum,
  onPageJump, onPageNavigate,
  // Tag panel
  showTagPanel, onTagPanelToggle,
  selectedTags,
}: SearchBarProps) {
  const sources = useSources()
  const searchModes = useSearchModes()
  const rankingOptions = useRankingOptions()
  const copymangaCategories = useCopymangaCategories()
  const bikaLeaderboardOptions = useBikaLeaderboardOptions()
  const nhRankingOptions = useNhRankingOptions()
  const isCopymangaCategory = mode === 'ranking' && source === 'copymanga'
  const isBikaLeaderboard = mode === 'ranking' && source === 'bika'
  const isNhRanking = mode === 'ranking' && source === 'nh'
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

        {showTagPanel && (
          <button
            onClick={onTagPanelToggle}
            className="flex items-center gap-1 px-3 py-2 rounded-lg border border-[var(--border)]
                       text-sm text-[var(--text-primary)] bg-[var(--bg-secondary)]
                       hover:bg-[var(--bg-primary)] transition-colors whitespace-nowrap"
          >
            <span>🏷</span>
            <span>标签</span>
            {selectedTags.length > 0 && (
              <span className="px-1.5 py-0.5 text-xs rounded-full bg-[var(--accent)] text-white">
                {selectedTags.length}
              </span>
            )}
          </button>
        )}

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
          {mode === 'ranking' && sourceSupportsRanking(source) && !isCopymangaCategory && !isBikaLeaderboard && !isNhRanking ? (
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
          ) : isBikaLeaderboard ? (
            <select
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              className="flex-1 bg-transparent border-none py-2 pl-3 pr-4 text-[var(--text-primary)]
                         text-sm outline-none cursor-pointer"
            >
              {bikaLeaderboardOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          ) : isNhRanking ? (
            <select
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              className="flex-1 bg-transparent border-none py-2 pl-3 pr-4 text-[var(--text-primary)]
                         text-sm outline-none cursor-pointer"
            >
              {nhRankingOptions.map(opt => (
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
            onBatchDownloadAsAlbum={onBatchDownloadAsAlbum}
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

    </div>
  )
}
