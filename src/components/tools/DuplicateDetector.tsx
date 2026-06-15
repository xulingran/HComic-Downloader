import { useState, useCallback, useMemo } from 'react'
import type { ComicInfo } from '@shared/types'
import { SOURCES_WITH_FAVOURITES, SOURCE_LABELS } from '@shared/types'
import { useFavourites } from '@/hooks/useIpc'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { findDuplicateGroups, groupFingerprint, type DuplicateGroup } from '@/utils/titleSimilarity'
import { DuplicateGroup as DuplicateGroupView } from './DuplicateGroup'
import { DuplicateBlacklistManager } from './DuplicateBlacklistManager'

type DetectionStatus = 'idle' | 'fetching' | 'computing' | 'done'

interface GroupWithMeta {
  group: DuplicateGroup
  fingerprint: string
  index: number
}

export function DuplicateDetector() {
  const { getFavourites } = useFavourites()
  const sources = useMemo(() =>
    SOURCES_WITH_FAVOURITES.map(s => ({ value: s, label: SOURCE_LABELS[s] })),
  [])
  const [source, setSource] = useState('hcomic')
  const [status, setStatus] = useState<DetectionStatus>('idle')
  const [progress, setProgress] = useState('')
  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [totalFetched, setTotalFetched] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [skippedPages, setSkippedPages] = useState(0)
  const [managerOpen, setManagerOpen] = useState(false)

  const duplicateBlacklist = useSettingsStore(s => s.duplicateBlacklist)
  const addDuplicateIgnore = useSettingsStore(s => s.addDuplicateIgnore)
  const removeDuplicateIgnore = useSettingsStore(s => s.removeDuplicateIgnore)
  const confirmMemberCount = useSettingsStore(s => s.confirmMemberCount)

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

      // 静默填充：对 memberCount=null 的条目，若本次检测到对应组，则填充当前成员数
      const fpToSize = new Map<string, number>()
      for (const g of duplicateGroups) fpToSize.set(groupFingerprint(g), g.comics.length)
      const entries = duplicateBlacklist[source as keyof typeof duplicateBlacklist] ?? []
      for (const entry of entries) {
        if (entry.memberCount === null && fpToSize.has(entry.fingerprint)) {
          confirmMemberCount(source, entry.fingerprint, fpToSize.get(entry.fingerprint)!)
        }
      }
    } catch {
      setError('获取收藏数据失败，请检查登录状态和网络连接')
      setStatus('done')
    }
  }, [getFavourites, source, duplicateBlacklist, confirmMemberCount])

  // 按指纹是否在当前来源的黑名单中拆分 active / ignored
  const { activeGroups, ignoredGroups, fingerprintToSize } = useMemo(() => {
    const entries = duplicateBlacklist[source as keyof typeof duplicateBlacklist] ?? []
    const ignoredFps = new Set(entries.map(e => e.fingerprint))
    const fpSize = new Map<string, number>()
    const active: GroupWithMeta[] = []
    const ignored: GroupWithMeta[] = []
    let activeIdx = 0
    let ignoredIdx = 0
    for (const group of groups) {
      const fp = groupFingerprint(group)
      fpSize.set(fp, group.comics.length)
      if (ignoredFps.has(fp)) {
        ignored.push({ group, fingerprint: fp, index: ignoredIdx++ })
      } else {
        active.push({ group, fingerprint: fp, index: activeIdx++ })
      }
    }
    return { activeGroups: active, ignoredGroups: ignored, fingerprintToSize: fpSize }
  }, [groups, duplicateBlacklist, source])

  // 徽章数字：memberCount 非 null 且与当前组成员数不等的条目数
  const changedCount = useMemo(() => {
    const entries = duplicateBlacklist[source as keyof typeof duplicateBlacklist] ?? []
    return entries.filter(e => {
      if (e.memberCount === null) return false
      const current = fingerprintToSize.get(e.fingerprint)
      return current !== undefined && current !== e.memberCount
    }).length
  }, [duplicateBlacklist, source, fingerprintToSize])

  const handleIgnore = useCallback((fp: string, size: number) => {
    addDuplicateIgnore(source, fp, size)
  }, [addDuplicateIgnore, source])

  const handleUnignore = useCallback((fp: string) => {
    removeDuplicateIgnore(source, fp)
  }, [removeDuplicateIgnore, source])

  return (
    <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
        <h3 className="text-base font-medium text-[var(--text-primary)]">重复检测</h3>
        <button
          onClick={() => setManagerOpen(true)}
          className="relative px-3 py-1 text-xs rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                     text-[var(--text-primary)] hover:bg-[var(--border)] transition-colors"
          title="管理已忽略的重复组"
        >
          ⚙ 管理已忽略
          {changedCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1
                             flex items-center justify-center text-[10px] font-medium
                             bg-red-500 text-white rounded-full">
              {changedCount}
            </span>
          )}
        </button>
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
            {ignoredGroups.length > 0 && `（其中 ${ignoredGroups.length} 组已忽略）`}
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

      {activeGroups.length > 0 && (
        <div className="space-y-3">
          {activeGroups.map(({ group, fingerprint, index }) => (
            <DuplicateGroupView
              key={group.comics[0]?.id ?? `active-${index}`}
              groupIndex={index}
              group={group}
              onIgnore={() => handleIgnore(fingerprint, group.comics.length)}
            />
          ))}
        </div>
      )}

      {ignoredGroups.length > 0 && (
        <>
          <div className="border-t border-[var(--border)] pt-3">
            <span className="text-xs font-medium text-[var(--text-secondary)]">
              已忽略（{ignoredGroups.length} 组，点击展开可取消忽略）
            </span>
          </div>
          <div className="space-y-3 opacity-80">
            {ignoredGroups.map(({ group, fingerprint, index }) => (
              <DuplicateGroupView
                key={group.comics[0]?.id ?? `ignored-${index}`}
                groupIndex={index}
                group={group}
                initialExpanded={false}
                ignored
                onUnignore={() => handleUnignore(fingerprint)}
              />
            ))}
          </div>
        </>
      )}

      {managerOpen && (
        <DuplicateBlacklistManager
          defaultSource={source}
          fingerprintToSize={fingerprintToSize}
          onClose={() => setManagerOpen(false)}
        />
      )}
    </div>
  )
}
