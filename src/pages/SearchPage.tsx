import { useState } from 'react'
import { useComicStore } from '../stores/useComicStore'
import { useSearch, useDownload } from '../hooks/useIpc'
import { ComicCard } from '../components/common/ComicCard'
import { ComicInfo } from '@shared/types'

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
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const { comics, pagination, isLoading, error, setComics, setPagination, setLoading, setError } = useComicStore()
  const { search } = useSearch()
  const { startDownload } = useDownload()

  const toggleSelect = (comic: ComicInfo) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(comic.id)) next.delete(comic.id)
      else next.add(comic.id)
      return next
    })
  }

  const selectAll = () => {
    setSelectedIds(new Set(comics.map(c => c.id)))
  }

  const clearSelection = () => {
    setSelectedIds(new Set())
  }

  const handleSearch = async (page: number = 1) => {
    if (!query.trim()) return
    clearSelection()

    setLoading(true)
    setError(null)

    try {
      const result = await search(query, mode, page)
      setComics(result.comics)
      setPagination(result.pagination)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  const handleComicClick = (comic: ComicInfo) => {
    console.log('Comic clicked:', comic)
  }

  const handleDownload = async (comic: ComicInfo) => {
    try {
      await startDownload(comic.id, comic)
    } catch (err) {
      console.error('Download failed:', err)
    }
  }

  const handleBatchDownload = async () => {
    for (const id of selectedIds) {
      const comic = comics.find(c => c.id === id)
      if (comic) await handleDownload(comic)
    }
    clearSelection()
    setBatchMode(false)
  }

  return (
    <div className="space-y-6">
      <div className="bg-[var(--bg-primary)] rounded-xl p-4 shadow-sm">
        <div className="flex gap-3 mb-3">
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
        </div>

        <div className="flex gap-3">
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
              <button onClick={selectAll} className="px-3 py-1 text-sm rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] hover:bg-[var(--bg-tertiary)]">
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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {comics.map((comic) => (
            <ComicCard
              key={comic.id}
              comic={comic}
              onClick={handleComicClick}
              batchMode={batchMode}
              selected={selectedIds.has(comic.id)}
              onToggleSelect={toggleSelect}
              onDownload={handleDownload}
            />
          ))}
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => handleSearch(pagination.currentPage - 1)}
            disabled={pagination.currentPage <= 1}
            className="px-3 py-1 rounded bg-[var(--bg-primary)] border border-[var(--border)]
                       disabled:opacity-50"
          >
            上一页
          </button>
          <span className="px-3 py-1 text-[var(--text-primary)]">
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

      {!isLoading && comics.length === 0 && (
        <div className="text-center text-[var(--text-secondary)] py-12">
          输入关键词开始搜索
        </div>
      )}
    </div>
  )
}
