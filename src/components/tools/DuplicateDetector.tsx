import { useState, useCallback } from 'react'
import type { ComicInfo } from '@shared/types'
import { useFavourites } from '@/hooks/useIpc'
import { findDuplicateGroups, type DuplicateGroup } from '@/utils/titleSimilarity'
import { DuplicateGroup as DuplicateGroupView } from './DuplicateGroup'

const sources = [
  { value: 'hcomic', label: 'HComic' },
  { value: 'moeimg', label: 'MoeImg' },
  { value: 'jmcomic', label: '禁漫天堂' },
]

type DetectionStatus = 'idle' | 'fetching' | 'computing' | 'done'

export function DuplicateDetector() {
  const { getFavourites } = useFavourites()
  const [source, setSource] = useState('hcomic')
  const [status, setStatus] = useState<DetectionStatus>('idle')
  const [progress, setProgress] = useState('')
  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [totalFetched, setTotalFetched] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [skippedPages, setSkippedPages] = useState(0)

  const handleDetect = useCallback(async () => {
    setStatus('fetching')
    setGroups([])
    setTotalFetched(0)
    setError(null)
    setSkippedPages(0)

    try {
      const first = await getFavourites(1, source)
      const totalPages = first.pagination?.totalPages ?? 1
      const allComics: ComicInfo[] = [...first.comics]
      setProgress(`正在获取第 1/${totalPages} 页...`)

      for (let page = 2; page <= totalPages; page++) {
        try {
          const result = await getFavourites(page, source)
          allComics.push(...result.comics)
          setProgress(`正在获取第 ${page}/${totalPages} 页...`)
        } catch {
          setSkippedPages(prev => prev + 1)
        }
      }

      setTotalFetched(allComics.length)
      setStatus('computing')
      setProgress('正在计算相似度...')

      const duplicateGroups = findDuplicateGroups(allComics)
      setGroups(duplicateGroups)
      setStatus('done')
    } catch {
      setError('获取收藏数据失败，请检查登录状态和网络连接')
      setStatus('done')
    }
  }, [getFavourites, source])

  return (
    <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
        <h3 className="text-base font-medium text-[var(--text-primary)]">重复检测</h3>
      </div>

      <p className="text-sm text-[var(--text-secondary)]">
        分析收藏夹中标题相似的漫画，找出可能重复的条目。点击漫画可打开详情抽屉。
      </p>

      <div className="flex items-center gap-3">
        <select
          value={source}
          onChange={e => setSource(e.target.value)}
          disabled={status === 'fetching' || status === 'computing'}
          className="px-3 py-1.5 text-sm bg-[var(--bg-secondary)] border border-[var(--border)]
                     rounded-lg text-[var(--text-primary)]"
        >
          {sources.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>

        <button
          onClick={handleDetect}
          disabled={status === 'fetching' || status === 'computing'}
          className="px-4 py-1.5 rounded-lg bg-[var(--accent)] text-white text-sm
                     disabled:opacity-50 hover:bg-[var(--accent-hover)] transition-colors"
        >
          {status === 'fetching' || status === 'computing' ? progress : '开始检测'}
        </button>

        {status === 'done' && totalFetched > 0 && (
          <span className="text-sm text-[var(--text-secondary)]">
            已分析 {totalFetched} 本漫画，发现 {groups.length} 组疑似重复
          </span>
        )}
      </div>

      {status === 'idle' && (
        <p className="text-sm text-[var(--text-secondary)] py-4 text-center">
          选择来源并点击开始检测
        </p>
      )}

      {error && (
        <p className="text-sm text-red-500 py-2">{error}</p>
      )}

      {skippedPages > 0 && (
        <p className="text-sm text-yellow-600 py-2">
          警告：{skippedPages} 页数据获取失败，结果可能不完整
        </p>
      )}

      {status === 'done' && groups.length === 0 && totalFetched > 0 && (
        <p className="text-sm text-[var(--text-secondary)] py-4 text-center">
          未发现疑似重复的漫画
        </p>
      )}

      {groups.length > 0 && (
        <div className="space-y-3">
          {groups.map((group, i) => (
            <DuplicateGroupView key={group.comics[0]?.id ?? i} groupIndex={i} group={group} />
          ))}
        </div>
      )}
    </div>
  )
}
