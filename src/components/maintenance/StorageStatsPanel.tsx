import { useState, useCallback, useEffect, useMemo } from 'react'
import { useMaintenance } from '@/hooks/useIpc'
import { useToastStore } from '@/stores/useToastStore'
import type { StorageStats, StorageTopItem, StorageDistribution } from '@shared/types'
import { Panel, Button } from './ui'
import { formatSize } from './utils'

function DistributionList({ items }: { items: StorageDistribution[] }) {
  if (items.length === 0) return null
  const max = Math.max(...items.map(i => i.sizeBytes))
  return (
    <div className="space-y-2">
      {items.map(item => (
        <div key={item.name} className="space-y-1">
          <div className="flex justify-between text-xs text-[var(--text-secondary)]">
            <span className="text-[var(--text-primary)]">{item.name}</span>
            <span>{formatSize(item.sizeBytes)} · {item.itemCount} 项</span>
          </div>
          <div className="h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--accent)]"
              style={{ width: `${max > 0 ? (item.sizeBytes / max) * 100 : 0}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

export function StorageStatsPanel() {
  const { getStorageStats } = useMaintenance()
  const toast = useToastStore()
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState<StorageStats | null>(null)

  const handleLoad = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getStorageStats()
      setStats(res)
    } catch (e) {
      toast.error(`加载存储统计失败：${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [getStorageStats, toast])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    handleLoad()
  }, [handleLoad])

  const sourceEntries = useMemo(() => {
    if (!stats) return []
    const total = Object.values(stats.bySource).reduce((a, b) => a + b, 0) || 1
    return Object.entries(stats.bySource)
      .map(([name, sizeBytes]) => ({ name, sizeBytes, ratio: total > 0 ? (sizeBytes / total) * 100 : 0 }))
      .sort((a, b) => b.sizeBytes - a.sizeBytes)
  }, [stats])

  const formatEntries = useMemo(() => {
    if (!stats) return []
    const total = stats.totalSizeBytes || 1
    return Object.entries(stats.byFormat).map(([name, sizeBytes]) => ({
      name: name === 'folder' ? '文件夹' : name.toUpperCase(),
      sizeBytes,
      ratio: total > 0 ? (sizeBytes / total) * 100 : 0,
    }))
  }, [stats])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button onClick={handleLoad} disabled={loading}>
          {loading ? '加载中…' : '刷新统计'}
        </Button>
      </div>

      {stats && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Panel>
              <div className="text-xs text-[var(--text-secondary)]">总占用</div>
              <div className="text-xl font-semibold text-[var(--text-primary)]">{formatSize(stats.totalSizeBytes)}</div>
              <div className="text-xs text-[var(--text-secondary)]">{stats.totalFiles} 个文件/目录</div>
            </Panel>
            <Panel>
              <div className="text-xs text-[var(--text-secondary)]">孤儿文件</div>
              <div className="text-xl font-semibold text-[var(--text-primary)]">{stats.orphanFiles.count} 个</div>
              <div className="text-xs text-[var(--text-secondary)]">{formatSize(stats.orphanFiles.sizeBytes)}</div>
            </Panel>
            <Panel>
              <div className="text-xs text-[var(--text-secondary)]">最大来源</div>
              <div className="text-xl font-semibold text-[var(--text-primary)] truncate">
                {sourceEntries[0]?.name ?? '-'}
              </div>
              <div className="text-xs text-[var(--text-secondary)]">
                {sourceEntries[0] ? formatSize(sourceEntries[0].sizeBytes) : '-'}
              </div>
            </Panel>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel>
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">按来源分布</h3>
              <div className="space-y-2">
                {sourceEntries.map(s => (
                  <div key={s.name} className="space-y-1">
                    <div className="flex justify-between text-xs text-[var(--text-secondary)]">
                      <span className="text-[var(--text-primary)]">{s.name}</span>
                      <span>{formatSize(s.sizeBytes)} · {s.ratio.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                      <div className="h-full bg-[var(--accent)]" style={{ width: `${s.ratio}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel>
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">按格式分布</h3>
              <div className="space-y-2">
                {formatEntries.map(f => (
                  <div key={f.name} className="space-y-1">
                    <div className="flex justify-between text-xs text-[var(--text-secondary)]">
                      <span className="text-[var(--text-primary)]">{f.name}</span>
                      <span>{formatSize(f.sizeBytes)} · {f.ratio.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                      <div className="h-full bg-[var(--accent)]" style={{ width: `${f.ratio}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          {stats.topItems.length > 0 && (
            <Panel>
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">占用空间 Top {stats.topItems.length}</h3>
              <div className="max-h-60 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
                    <tr>
                      <th className="px-3 py-2 text-left">标题</th>
                      <th className="px-3 py-2 text-left">来源</th>
                      <th className="px-3 py-2 text-left">大小</th>
                      <th className="px-3 py-2 text-left">页数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.topItems.map((item: StorageTopItem, idx) => (
                      <tr key={idx} className="border-t border-[var(--border)] hover:bg-[var(--bg-secondary)]">
                        <td className="px-3 py-2 text-[var(--text-primary)] break-all max-w-xs">
                          {item.title || item.path}
                        </td>
                        <td className="px-3 py-2 text-[var(--text-secondary)]">{item.sourceSite || '-'}</td>
                        <td className="px-3 py-2 text-[var(--text-primary)] whitespace-nowrap">{formatSize(item.sizeBytes)}</td>
                        <td className="px-3 py-2 text-[var(--text-secondary)]">{item.pageCount ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          {stats.byAuthor.length > 0 && (
            <Panel>
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">按作者分布 Top {stats.byAuthor.length}</h3>
              <DistributionList items={stats.byAuthor} />
            </Panel>
          )}
        </>
      )}
    </div>
  )
}
