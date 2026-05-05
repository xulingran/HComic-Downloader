import { useState, useEffect } from 'react'
import { useStatistics } from '../hooks/useIpc'
import { StatCard } from '../components/common/StatCard'
import { StatisticsData } from '@shared/types'

export function StatisticsPage() {
  const [stats, setStats] = useState<StatisticsData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const { getStatistics } = useStatistics()

  useEffect(() => {
    loadStatistics()
  }, [])

  const loadStatistics = async () => {
    setIsLoading(true)
    try {
      const result = await getStatistics()
      setStats(result)
    } catch (err) {
      console.error('Failed to load statistics:', err)
    } finally {
      setIsLoading(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-[var(--text-secondary)]">加载中...</div>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="text-center text-[var(--text-secondary)] py-12">
        无法加载统计数据
      </div>
    )
  }

  const successRate = stats.totalDownloads > 0
    ? Math.round((stats.completedDownloads / stats.totalDownloads) * 100)
    : 0

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          数据统计
        </h2>
        <button
          onClick={loadStatistics}
          className="px-3 py-1 text-sm bg-[var(--bg-primary)] border border-[var(--border)] 
                     rounded-lg hover:bg-[var(--bg-secondary)] transition-colors"
        >
          刷新
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="总下载"
          value={stats.totalDownloads}
          icon="📥"
          color="var(--accent)"
        />
        <StatCard
          title="已完成"
          value={stats.completedDownloads}
          icon="✅"
          color="var(--success)"
        />
        <StatCard
          title="失败"
          value={stats.failedDownloads}
          icon="❌"
          color="var(--error)"
          subtitle={`${successRate}% 成功率`}
        />
        <StatCard
          title="总大小"
          value={formatSize(stats.totalSize)}
          icon="💾"
          color="var(--warning)"
        />
      </div>

      {stats.downloadsByDay.length > 0 && (
        <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm">
          <h3 className="text-sm font-medium text-[var(--text-primary)] mb-4">
            下载趋势
          </h3>
          <div className="h-48 flex items-end gap-2">
            {stats.downloadsByDay.map((day, i) => {
              const maxCount = Math.max(...stats.downloadsByDay.map(d => d.count))
              const height = maxCount > 0 ? (day.count / maxCount) * 100 : 0
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full bg-[var(--accent)] rounded-t"
                    style={{ height: `${height}%` }}
                  />
                  <span className="text-xs text-[var(--text-secondary)]">
                    {day.date.slice(5)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}
