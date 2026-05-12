import { useState, useEffect, useRef } from 'react'
import { useComicStore } from '../stores/useComicStore'
import { useSearch, useConfig } from '../hooks/useIpc'
import { useDownloadHelper } from '../hooks/useDownloadHelper'
import { useBatchSelect, getComicKey } from '../hooks/useBatchSelect'
import { ComicCard } from '../components/common/ComicCard'
import { ComicInfo } from '@shared/types'
import { useSettingsStore } from '../stores/useSettingsStore'

const searchModes = [
  { value: 'keyword', label: '关键词' },
  { value: 'author', label: '作者' },
  { value: 'tag', label: 'Tag' }
]

const sources = [
  { value: 'hcomic', label: 'HComic' },
  { value: 'moeimg', label: 'Moeimg' }
]

export function SearchPage() {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('keyword')
  const [source, setSource] = useState('hcomic')
  const [jumpPage, setJumpPage] = useState('')
  const [showJumpDialog, setShowJumpDialog] = useState(false)
  const { comics, pagination, isLoading, error, setComics, setPagination, setLoading, setError } = useComicStore()
  const { search } = useSearch()
  const { downloadWithConflictCheck } = useDownloadHelper()
  const { getConfig } = useConfig()
  const {
    batchMode,
    setBatchMode,
    selectedIds,
    toggleSelect,
    selectAll,
    clearSelection,
    exitBatchMode,
  } = useBatchSelect()
  const { cardStyle } = useSettingsStore()

  const searchGenRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    const gen = ++searchGenRef.current
    setLoading(true)

    getConfig().then(result => {
      if (cancelled) return
      const resolvedSource = result.config.defaultSource || source
      if (result.config.defaultSource) {
        setSource(result.config.defaultSource)
      }
      return search('', mode, 1, resolvedSource)
    }).then(result => {
      if (cancelled || gen !== searchGenRef.current) return
      if (result) {
        setComics(result.comics)
        setPagination(result.pagination)
      }
    }).catch(err => {
      if (cancelled || gen !== searchGenRef.current) return
      setError(err instanceof Error ? err.message : 'Search failed')
    }).finally(() => {
      if (!cancelled && gen === searchGenRef.current) {
        setLoading(false)
      }
    })

    return () => { cancelled = true }
  }, [])

  const handleSearch = async (page: number = 1) => {
    clearSelection()

    const gen = ++searchGenRef.current
    setLoading(true)
    setError(null)

    try {
      const result = await search(query, mode, page, source)
      if (gen !== searchGenRef.current) return  // 丢弃旧请求的响应
      setComics(result.comics)
      setPagination(result.pagination)
    } catch (err) {
      if (gen !== searchGenRef.current) return
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      if (gen === searchGenRef.current) {
        setLoading(false)
      }
    }
  }

  const handleComicClick = (comic: ComicInfo) => {
    console.log('Comic clicked:', comic)
  }

  const handleDownload = async (comic: ComicInfo) => {
    await downloadWithConflictCheck(comic)
  }

  const handleBatchDownload = async () => {
    for (const key of selectedIds) {
      const comic = comics.find(c => getComicKey(c) === key)
      if (comic) await handleDownload(comic)
    }
    exitBatchMode()
  }

  return (
    <div className="space-y-6">
      <div className="bg-[var(--bg-primary)] rounded-xl p-4 shadow-sm">
        <div className="flex gap-3">
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                       text-[var(--text-primary)] text-sm"
          >
            {sources.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                       text-[var(--text-primary)] text-sm"
          >
            {searchModes.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="输入搜索内容..."
            className="flex-1 px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                       text-[var(--text-primary)] placeholder-[var(--text-secondary)]
                       focus:outline-none focus:border-[var(--accent)]"
          />

          <button
            onClick={() => handleSearch()}
            disabled={isLoading}
            className="px-6 py-2 bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)]
                       disabled:opacity-50 transition-colors"
          >
            {isLoading ? '搜索中...' : '搜索'}
          </button>
        </div>

        {/* ── Query context hint ── */}
        <div className="mt-2 text-xs text-[var(--text-secondary)]">
          源: {sources.find(s => s.value === source)?.label} | 模式: {searchModes.find(m => m.value === mode)?.label}
          {pagination && ` | 第 ${pagination.currentPage}/${pagination.totalPages} 页`}
          {pagination && pagination.totalItems > 0 && ` | 共 ${pagination.totalItems} 条结果`}
        </div>
      </div>

      {comics.length > 0 && (
        <div className="flex items-center gap-3 bg-[var(--bg-primary)] rounded-xl p-3 shadow-sm">
          <label className="flex items-center gap-2 text-sm text-[var(--text-primary)] cursor-pointer">
            <input
              type="checkbox"
              checked={batchMode}
              onChange={(e) => {
                setBatchMode(e.target.checked)
                if (!e.target.checked) clearSelection()
              }}
              className="rounded"
            />
            批量选择模式
          </label>
          {batchMode && (
            <>
              <button onClick={() => selectAll(comics)} className="px-3 py-1 text-sm rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] hover:bg-[var(--bg-tertiary)]">
                全选
              </button>
              <button onClick={clearSelection} className="px-3 py-1 text-sm rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] hover:bg-[var(--bg-tertiary)]">
                取消
              </button>
              <button
                onClick={handleBatchDownload}
                disabled={selectedIds.size === 0}
                className="px-3 py-1 text-sm rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
              >
                批量下载({selectedIds.size})
              </button>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="p-4 bg-[var(--error)]/10 text-[var(--error)] rounded-lg">
          {error}
        </div>
      )}

      {comics.length > 0 && (
        <div className={cardStyle === 'detailed'
          ? 'flex flex-col bg-[var(--bg-primary)] rounded-xl shadow-sm overflow-hidden'
          : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4'
        }>
          {comics.map((comic) => (
            <ComicCard
              key={getComicKey(comic)}
              comic={comic}
              onClick={handleComicClick}
              batchMode={batchMode}
              selected={selectedIds.has(getComicKey(comic))}
              onToggleSelect={toggleSelect}
              onDownload={handleDownload}
            />
          ))}
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="flex justify-center items-center gap-2">
          <button
            onClick={() => handleSearch(pagination.currentPage - 1)}
            disabled={pagination.currentPage <= 1}
            className="px-3 py-1 rounded bg-[var(--bg-primary)] border border-[var(--border)]
                       disabled:opacity-50"
          >
            上一页
          </button>
          <span
            onClick={() => {
              setJumpPage(String(pagination.currentPage))
              setShowJumpDialog(true)
            }}
            className="px-3 py-1 text-[var(--accent)] cursor-pointer hover:underline"
            title="点击跳转到指定页"
          >
            {pagination.currentPage} / {pagination.totalPages}
          </span>
          <button
            onClick={() => handleSearch(pagination.currentPage + 1)}
            disabled={pagination.currentPage >= pagination.totalPages}
            className="px-3 py-1 rounded bg-[var(--bg-primary)] border border-[var(--border)]
                       disabled:opacity-50"
          >
            下一页
          </button>
        </div>
      )}

      {/* ── Page jump dialog ── */}
      {showJumpDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowJumpDialog(false)}>
          <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-lg max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4">跳转到指定页</h3>
            <input
              type="number"
              value={jumpPage}
              onChange={(e) => setJumpPage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const page = parseInt(jumpPage, 10)
                  if (page >= 1 && page <= (pagination?.totalPages || 1)) {
                    handleSearch(page)
                    setShowJumpDialog(false)
                  }
                }
              }}
              min={1}
              max={pagination?.totalPages || 1}
              placeholder={`1 - ${pagination?.totalPages || 1}`}
              className="w-full px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                         text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowJumpDialog(false)}
                className="px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)]"
              >
                取消
              </button>
              <button
                onClick={() => {
                  const page = parseInt(jumpPage, 10)
                  if (page >= 1 && page <= (pagination?.totalPages || 1)) {
                    handleSearch(page)
                    setShowJumpDialog(false)
                  }
                }}
                className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white"
              >
                跳转
              </button>
            </div>
          </div>
        </div>
      )}

      {!isLoading && comics.length === 0 && (
        <div className="text-center text-[var(--text-secondary)] py-12">
          暂无搜索结果
        </div>
      )}
    </div>
  )
}
