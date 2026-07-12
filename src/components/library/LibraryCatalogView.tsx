import { useEffect, useCallback, useState, useRef } from 'react'
import { useLibraryStore } from '../../stores/useLibraryStore'
import { useLibrary, useLibraryScan, useLibraryScanProgress } from '../../hooks/useIpc'
import { ACTIVE_DOWNLOAD_STATUSES } from '@shared/types'
import { useDownloadStore } from '../../stores/useDownloadStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { LIBRARY_FORMATS, LIBRARY_SORTS } from '@shared/types'
import type { LibraryFormat, LibrarySort, LibraryAssetDetail } from '@shared/types'
import { useLocalReaderStore } from '../../stores/useLocalReaderStore'
import type { LocalReaderLaunchMode } from '../../stores/useLocalReaderStore'
import { LibraryAssetDetailDrawer } from './LibraryAssetDetailDrawer'

/** 活跃下载任务数（供漫画库头部显示）。 */
function useActiveDownloadCount() {
  const tasks = useDownloadStore((s) => s.tasks)
  return tasks.filter((t) => ACTIVE_DOWNLOAD_STATUSES.has(t.status)).length
}

/** 漫画库目录视图——网格/列表浏览、搜索、筛选、排序和扫描控制。 */
export function LibraryCatalogView() {
  // 只选择渲染所需的数据字段，避免 store 整体引用变化导致不必要的重渲染
  const items = useLibraryStore((s) => s.items)
  const isLoading = useLibraryStore((s) => s.isLoading)
  const error = useLibraryStore((s) => s.error)
  const totalPages = useLibraryStore((s) => s.totalPages)
  const currentPage = useLibraryStore((s) => s.currentPage)
  const stats = useLibraryStore((s) => s.stats)
  const scanState = useLibraryStore((s) => s.scanState)

  // 查询条件
  const query = useLibraryStore((s) => s.query)
  const sourceSite = useLibraryStore((s) => s.sourceSite)
  const format = useLibraryStore((s) => s.format)
  const healthStatus = useLibraryStore((s) => s.healthStatus)
  const sort = useLibraryStore((s) => s.sort)
  const viewMode = useLibraryStore((s) => s.viewMode)

  // SFW 模式
  const sfwMode = useSettingsStore((s) => s.sfwMode)

  const library = useLibrary()
  const scan = useLibraryScan()
  const { progress: scanProgress } = useLibraryScanProgress()
  const activeDownloadCount = useActiveDownloadCount()

  // 阅读器状态（提升到 App 根的 store，避免 fixed 定位被页面 motion.div 的
  // transform 包含块截断）
  const openLocalReader = useLocalReaderStore((s) => s.openReader)
  const justClosedAssetId = useLocalReaderStore((s) => s.justClosedAssetId)
  // 详情抽屉状态
  const [detailAsset, setDetailAsset] = useState<LibraryAssetDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const loadList = useCallback(async () => {
    const store = useLibraryStore.getState()
    const reqId = store.nextRequestId()
    store.setLoading(true)
    try {
      const queryObj = store.getCurrentQuery()
      const result = await library.list(queryObj)
      if (reqId !== useLibraryStore.getState().requestId) return
      useLibraryStore.getState().setItems(result.items, result.pagination)
    } catch (err) {
      if (reqId !== useLibraryStore.getState().requestId) return
      useLibraryStore.getState().setError(err instanceof Error ? err.message : '加载漫画库失败')
    }
  }, [library])

  const loadStats = useCallback(async () => {
    try {
      const s = await library.stats()
      useLibraryStore.getState().setStats(s)
    } catch {
      // 统计失败不阻塞
    }
  }, [library])

  const loadScanStatus = useCallback(async () => {
    try {
      const state = await scan.status()
      useLibraryStore.getState().setScanState(state)
    } catch {
      // 状态获取失败不阻塞
    }
  }, [scan])

  // 初次加载统计和扫描状态；列表由查询 effect 单一负责，避免重复请求。
  useEffect(() => {
    loadStats()
    loadScanStatus()
  }, [loadStats, loadScanStatus])

  // keep-alive 页面恢复会话内滚动位置。
  useEffect(() => {
    const scrollContainer = rootRef.current?.closest('.overflow-auto') as HTMLElement | null
    if (!scrollContainer) return
    scrollContainer.scrollTop = useLibraryStore.getState().scrollPosition
    const onScroll = () => useLibraryStore.getState().setScrollPosition(scrollContainer.scrollTop)
    scrollContainer.addEventListener('scroll', onScroll, { passive: true })
    return () => scrollContainer.removeEventListener('scroll', onScroll)
  }, [])

  // 首次访问时若索引为空且未在扫描，自动触发完整扫描
  // （spec: library-workspace "首次进入工作区…系统显示漫画库子页签及本地资产列表"）
  const autoScanTriggered = useRef(false)
  useEffect(() => {
    if (autoScanTriggered.current) return
    // 等列表加载完成且扫描状态已知后再判断
    if (isLoading || !scanState) return
    autoScanTriggered.current = true
    if (!scanState.isScanning && scanState.lastScanCompletedAt === null && items.length === 0) {
      scan.start().then(() => loadScanStatus()).catch(() => {})
    }
  }, [isLoading, scanState, items.length, scan, loadScanStatus])

  // 查询条件变化时重新加载
  useEffect(() => {
    loadList()
  }, [query, sourceSite, format, healthStatus, sort, currentPage, loadList])

  // 扫描进度更新——实时刷新扫描状态
  useEffect(() => {
    if (scanProgress) {
      loadScanStatus()
    }
  }, [scanProgress, loadScanStatus])

  // 扫描完成时（isScanning 从 true→false）自动刷新列表和统计
  const prevScanningRef = useRef(false)
  useEffect(() => {
    const wasScanning = prevScanningRef.current
    const nowScanning = scanState?.isScanning ?? false
    prevScanningRef.current = nowScanning
    if (wasScanning && !nowScanning) {
      // 扫描刚结束，重新加载列表
      loadList()
      loadStats()
    }
  }, [scanState?.isScanning, loadList, loadStats])

  const handleStartScan = async () => {
    try {
      await scan.start()
      loadScanStatus()
    } catch {
      // ignore
    }
  }

  const handleCancelScan = async () => {
    try {
      await scan.cancel()
      loadScanStatus()
    } catch {
      // ignore
    }
  }

  const handleRefresh = async () => {
    await loadList()
    await loadStats()
  }

  // 点击卡片打开详情抽屉
  const handleCardClick = useCallback(
    async (assetId: string) => {
      try {
        const detail = await library.detail(assetId)
        setDetailAsset(detail)
        setDetailOpen(true)
      } catch {
        // 详情获取失败
      }
    },
    [library],
  )

  // 从详情抽屉打开阅读器
  const handleOpenReader = useCallback(async (assetId: string, launchMode: LocalReaderLaunchMode) => {
    try {
      const detail = await library.detail(assetId)
      setDetailOpen(false)
      openLocalReader(detail, launchMode)
    } catch {
      // ignore
    }
  }, [library, openLocalReader])

  // 阅读器在 App 根关闭后，通过 justClosedAssetId 触发列表/统计刷新（进度可能已更新）
  useEffect(() => {
    if (!justClosedAssetId) return
    loadList()
    loadStats()
  }, [justClosedAssetId, loadList, loadStats])

  // 仅翻 detailOpen，保留 detailAsset 供 AnimatePresence 退场动画期间渲染面板内容；
  // 下次打开或组件卸载时自然清空，与 ComicInfoDrawer 的 closeDrawer 行为对齐
  const handleCloseDetail = useCallback(() => {
    setDetailOpen(false)
  }, [])

  // 详情变更后刷新列表
  const handleDetailChanged = useCallback(() => {
    loadList()
    loadStats()
  }, [loadList, loadStats])

  const isScanning = scanState?.isScanning ?? false
  const hasItems = items.length > 0

  return (
    <div ref={rootRef} data-testid="library-catalog-view" className="space-y-4">
      {/* 头部工具栏 */}
      <div className="flex flex-wrap items-center gap-3">
        {/* 搜索框 */}
        <input
          type="text"
          placeholder="搜索标题、作者或标签…"
          value={query}
          onChange={(e) => useLibraryStore.getState().setQuery({ query: e.target.value })}
          className="flex-1 min-w-[200px] px-3 py-1.5 text-sm rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
          data-testid="library-search-input"
        />

        {/* 格式筛选 */}
        <select
          value={format}
          onChange={(e) => useLibraryStore.getState().setQuery({ format: e.target.value as LibraryFormat | '' })}
          className="px-2 py-1.5 text-sm rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)]"
          data-testid="library-format-filter"
        >
          <option value="">全部格式</option>
          {LIBRARY_FORMATS.map((f) => (
            <option key={f} value={f}>
              {f.toUpperCase()}
            </option>
          ))}
        </select>

        {/* 来源筛选 */}
        <select
          value={sourceSite}
          onChange={(e) => useLibraryStore.getState().setQuery({ sourceSite: e.target.value })}
          className="px-2 py-1.5 text-sm rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)]"
          data-testid="library-source-filter"
        >
          <option value="">全部来源</option>
          {Object.keys(stats?.bySource ?? {}).filter(Boolean).sort().map((source) => (
            <option key={source} value={source}>{source}</option>
          ))}
        </select>

        {/* 健康状态筛选 */}
        <select
          value={healthStatus}
          onChange={(e) => useLibraryStore.getState().setQuery({ healthStatus: e.target.value as import('@shared/types').LibraryHealthStatus | '' })}
          className="px-2 py-1.5 text-sm rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)]"
          data-testid="library-health-filter"
        >
          <option value="">全部健康状态</option>
          <option value="unknown">未检查</option>
          <option value="healthy">健康</option>
          <option value="warning">有警告</option>
          <option value="error">有问题</option>
        </select>

        {/* 排序 */}
        <select
          value={sort}
          onChange={(e) => useLibraryStore.getState().setQuery({ sort: e.target.value as LibrarySort })}
          className="px-2 py-1.5 text-sm rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)]"
          data-testid="library-sort-select"
        >
          {LIBRARY_SORTS.map((s) => (
            <option key={s} value={s}>
              {SORT_LABELS[s]}
            </option>
          ))}
        </select>

        <div className="flex rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-0.5" data-testid="library-view-toggle">
          <button
            aria-label="网格视图"
            onClick={() => useLibraryStore.getState().setViewMode('grid')}
            className={`rounded px-2 py-1 text-xs ${viewMode === 'grid' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)]'}`}
          >▦</button>
          <button
            aria-label="列表视图"
            onClick={() => useLibraryStore.getState().setViewMode('list')}
            className={`rounded px-2 py-1 text-xs ${viewMode === 'list' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)]'}`}
          >☰</button>
        </div>

        {/* 扫描按钮 */}
        {isScanning ? (
          <button
            onClick={handleCancelScan}
            className="px-3 py-1.5 text-sm bg-[var(--error)] text-white rounded-lg hover:opacity-90 transition-opacity"
            data-testid="library-cancel-scan-btn"
          >
            取消扫描
          </button>
        ) : (
          <button
            onClick={handleStartScan}
            className="px-3 py-1.5 text-sm bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)] transition-colors"
            data-testid="library-start-scan-btn"
          >
            扫描漫画库
          </button>
        )}

        {/* 刷新 */}
        <button
          onClick={handleRefresh}
          className="px-3 py-1.5 text-sm bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg hover:bg-[var(--bg-secondary)] transition-colors"
        >
          刷新
        </button>
      </div>

      {/* 统计信息 */}
      {stats && (
        <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--text-secondary)]">
          <span data-testid="library-stat-total">{stats.totalAssets} 本漫画</span>
          <span>{stats.totalPages} 页</span>
          <span>{formatBytes(stats.totalSizeBytes)}</span>
          {activeDownloadCount > 0 && <span className="text-[var(--accent)]">{activeDownloadCount} 个下载中</span>}
        </div>
      )}

      {/* 扫描进度 */}
      {isScanning && scanState && (
        <div
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-4 py-3 text-sm text-[var(--text-secondary)]"
          data-testid="library-scan-progress"
        >
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
            <span>
              正在扫描… {scanState.current}/{scanState.total} —{' '}
              {scanState.currentLabel || SCAN_PHASE_LABELS[scanState.phase] || scanState.phase}
            </span>
          </div>
          {scanState.total > 0 && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--bg-secondary)]">
              <div
                className="h-full bg-[var(--accent)] transition-all"
                style={{ width: `${Math.round((scanState.current / scanState.total) * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* 错误状态 */}
      {error && (
        <div
          className="rounded-lg border border-[var(--error)]/30 bg-[var(--error)]/5 px-4 py-3 text-sm text-[var(--error)]"
          data-testid="library-error"
        >
          {error}
        </div>
      )}

      {/* 加载状态 */}
      {isLoading && !hasItems && (
        <div className="py-16 text-center text-sm text-[var(--text-secondary)]" data-testid="library-loading">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]" />
          <p className="mt-2">正在加载漫画库…</p>
        </div>
      )}

      {/* 空状态 */}
      {!isLoading && !hasItems && !error && (
        <div
          className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] px-6 py-16 text-center text-[var(--text-secondary)]"
          data-testid="library-empty"
        >
          {query || format || healthStatus || sourceSite ? '没有符合条件的漫画' : '漫画库为空，点击"扫描漫画库"开始索引'}
        </div>
      )}

      {/* 网格列表 */}
      {hasItems && (
        <div className={viewMode === 'grid' ? 'grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5' : 'space-y-2'} data-testid={viewMode === 'grid' ? 'library-grid' : 'library-list'}>
          {items.map((item) => (
            <LibraryCard
              key={item.assetId}
              item={item}
              sfwMode={sfwMode}
              viewMode={viewMode}
              onClick={() => handleCardClick(item.assetId)}
            />
          ))}
        </div>
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4" data-testid="library-pagination">
          <button
            onClick={() => currentPage > 1 && useLibraryStore.setState({ currentPage: currentPage - 1 })}
            disabled={currentPage <= 1}
            className="px-3 py-1 text-sm rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)] disabled:opacity-40"
          >
            上一页
          </button>
          <span className="text-sm text-[var(--text-secondary)]">
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => currentPage < totalPages && useLibraryStore.setState({ currentPage: currentPage + 1 })}
            disabled={currentPage >= totalPages}
            className="px-3 py-1 text-sm rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)] disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      )}

      {/* 资产详情抽屉 */}
      <LibraryAssetDetailDrawer
        asset={detailAsset}
        open={detailOpen}
        onClose={handleCloseDetail}
        onOpenReader={handleOpenReader}
        onChanged={handleDetailChanged}
      />
    </div>
  )
}

/** 漫画库卡片。 */
function LibraryCard({
  item,
  sfwMode,
  viewMode,
  onClick,
}: {
  item: import('@shared/types').LibraryAssetSummary
  sfwMode: boolean
  viewMode: 'grid' | 'list'
  onClick: () => void
}) {
  const library = useLibrary()
  const cardRef = useRef<HTMLDivElement>(null)
  const [coverKey, setCoverKey] = useState(item.coverKey)
  const [coverLoading, setCoverLoading] = useState(false)

  useEffect(() => {
    if (sfwMode || coverKey || !cardRef.current) return
    const element = cardRef.current
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
      setCoverLoading(true)
      library.cover(item.assetId)
        .then((result) => setCoverKey(result.coverKey))
        .catch(() => {})
        .finally(() => setCoverLoading(false))
    }, { rootMargin: '600px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [coverKey, item.assetId, library, sfwMode])

  const coverUrl = coverKey && !sfwMode ? `app-image://library/${coverKey}` : null
  return (
    <div
      ref={cardRef}
      className={`cursor-pointer overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] shadow-sm transition-shadow hover:shadow-md ${viewMode === 'list' ? 'flex min-h-24' : ''}`}
      data-testid={`library-card-${item.assetId}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {/* 封面 */}
      <div className={`relative aspect-[3/4] bg-[var(--bg-secondary)] ${viewMode === 'list' ? 'w-20 flex-shrink-0' : ''}`}>
        {coverUrl ? (
          <img src={coverUrl} alt={item.title} className="h-full w-full object-cover" loading="lazy" />
        ) : coverLoading ? (
          <div className="h-full w-full animate-pulse bg-[var(--bg-tertiary)]" />
        ) : (
          <div className="flex h-full items-center justify-center text-[var(--text-secondary)]">
            <span className="text-3xl">📖</span>
          </div>
        )}
        {/* 格式标签 */}
        <span className="absolute top-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
          {item.format.toUpperCase()}
        </span>
      </div>
      {/* 信息 */}
      <div className={`p-2 ${viewMode === 'list' ? 'min-w-0 flex-1 py-3' : ''}`}>
        <h3 className="truncate text-xs font-medium text-[var(--text-primary)]" title={item.title}>
          {item.title}
        </h3>
        <p className="mt-0.5 truncate text-[10px] text-[var(--text-secondary)]">{item.author}</p>
        {viewMode === 'list' && (
          <p className="mt-2 text-[10px] text-[var(--text-secondary)]">
            {item.pageCount} 页 · {formatBytes(item.sizeBytes)} · {item.sourceSite || '本地'}
          </p>
        )}
        {item.isAlbum && <span className="mt-0.5 inline-block text-[10px] text-[var(--accent)]">{item.chapterCount} 章</span>}
      </div>
    </div>
  )
}

// ── 常量 ──────────────────────────────────────────────────────────

const SORT_LABELS: Record<LibrarySort, string> = {
  recent_added: '最近添加',
  recent_read: '最近阅读',
  title: '标题',
  size: '大小',
  mtime: '修改时间',
}

const SCAN_PHASE_LABELS: Record<string, string> = {
  discovering: '发现资产',
  parsing: '解析元数据',
  committing: '提交索引',
  reconciling: '对账清理',
  idle: '空闲',
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Math.round((bytes / Math.pow(k, i)) * 10) / 10} ${sizes[i]}`
}
