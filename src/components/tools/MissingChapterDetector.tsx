import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import type { ComicInfo } from '@shared/types'
import { SOURCES_WITH_FAVOURITES, SOURCE_LABELS } from '@shared/types'
import { useFavourites } from '@/hooks/useIpc'
import { findDuplicateGroups, groupFingerprint, type DuplicateGroup } from '@/utils/titleSimilarity'
import { useMissingChaptersStore } from '@/stores/useMissingChaptersStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { MissingGroup } from './MissingGroup'
import { MissingBlacklistManager } from './MissingBlacklistManager'

type DetectionStatus = 'idle' | 'fetching' | 'computing' | 'done'

interface GroupWithMeta {
  group: DuplicateGroup
  fingerprint: string
  index: number
}

/**
 * 查缺补漏工具（design.md 决策 4）。
 *
 * 定位（v2 方向调整）：复用重复检测的相似度聚类，把收藏夹中"疑似同系列"
 * 的条目聚合展示，让用户自己判断是否缺漏；每组提供"搜索此系列"入口，
 * 复用项目既有的 pendingSearch 机制跳转搜索页用系列名搜索，方便用户
 * 在搜索结果里找漏收的。
 *
 * 忽略黑名单（照搬重复检测范式）：用户可将组标记为"已忽略"，持久化到
 * 独立的 missingBlacklist 配置字段（与 duplicateBlacklist 同构但隔离）。
 * ignored 组默认折叠渲染，提供"管理已忽略"面板与成员变动徽章。
 *
 * 结果持久化：检测结果存入 useMissingChaptersStore（按来源隔离），跨页面
 * 保留。挂载时用惰性初始化从 store 恢复；切换来源在 onChange 里恢复。
 */
export function MissingChapterDetector() {
  const { getFavourites } = useFavourites()
  const setResult = useMissingChaptersStore(s => s.setResult)
  const getCached = useMissingChaptersStore(s => s.results)

  const missingBlacklist = useSettingsStore(s => s.missingBlacklist)
  const addMissingIgnore = useSettingsStore(s => s.addMissingIgnore)
  const removeMissingIgnore = useSettingsStore(s => s.removeMissingIgnore)
  const confirmMissingMemberCount = useSettingsStore(s => s.confirmMissingMemberCount)

  // 惰性初始化：挂载时从 store 恢复当前来源（hcomic）的缓存
  const [source, setSource] = useState('hcomic')
  const initial = getCached['hcomic']
  const [status, setStatus] = useState<DetectionStatus>(initial ? 'done' : 'idle')
  const [progress, setProgress] = useState('')
  const [groups, setGroups] = useState<DuplicateGroup[]>(initial?.groups ?? [])
  const [totalFetched, setTotalFetched] = useState(initial?.totalFetched ?? 0)
  const [error, setError] = useState<string | null>(null)
  const [skippedPages, setSkippedPages] = useState(initial?.skippedPages ?? 0)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)

  // ref 镜像：async 闭包（handleDetect）内读 missingBlacklist 会拿到 stale 值，
  // 用 ref 同步最新值供静默填充逻辑使用。在 effect 里写 ref（非 render 阶段）。
  const missingBlacklistRef = useRef(missingBlacklist)
  useEffect(() => {
    missingBlacklistRef.current = missingBlacklist
  }, [missingBlacklist])

  // 切换来源：在 onChange 里直接恢复该来源缓存（不走 effect，避免规则告警）
  const handleSourceChange = useCallback((newSource: string) => {
    setSource(newSource)
    const cached = getCached[newSource]
    if (cached) {
      setGroups(cached.groups)
      setTotalFetched(cached.totalFetched)
      setSkippedPages(cached.skippedPages)
      setStatus('done')
      setError(null)
      setNeedsLogin(false)
    } else {
      setGroups([])
      setTotalFetched(0)
      setSkippedPages(0)
      setStatus('idle')
      setError(null)
      setNeedsLogin(false)
    }
  }, [getCached])

  // 按指纹是否在当前来源的黑名单中拆分 active / ignored（照搬重复检测范式）
  const { activeGroups, ignoredGroups, fingerprintToSize } = useMemo(() => {
    const entries = missingBlacklist[source as keyof typeof missingBlacklist] ?? []
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
  }, [groups, missingBlacklist, source])

  // 徽章数字：memberCount 非 null 且与当前组成员数不等的条目数
  const changedCount = useMemo(() => {
    const entries = missingBlacklist[source as keyof typeof missingBlacklist] ?? []
    return entries.filter(e => {
      if (e.memberCount === null) return false
      const current = fingerprintToSize.get(e.fingerprint)
      return current !== undefined && current !== e.memberCount
    }).length
  }, [missingBlacklist, source, fingerprintToSize])

  const handleIgnore = useCallback((fp: string, size: number) => {
    addMissingIgnore(source, fp, size)
  }, [addMissingIgnore, source])

  const handleUnignore = useCallback((fp: string) => {
    removeMissingIgnore(source, fp)
  }, [removeMissingIgnore, source])

  const handleDetect = useCallback(async () => {
    setStatus('fetching')
    setGroups([])
    setTotalFetched(0)
    setError(null)
    setSkippedPages(0)
    setNeedsLogin(false)
    // 局部计数器：async 闭包内读 state 会拿到 stale 值，用局部变量同步
    let localSkippedPages = 0

    try {
      const first = await getFavourites(1, source)
      // 未登录处理（spec 需求 9）
      if (first.needsLogin) {
        setNeedsLogin(true)
        setStatus('done')
        return
      }
      const totalPages = first.pagination?.totalPages ?? 1
      const allComics: ComicInfo[] = [...first.comics]
      setProgress(`正在获取第 1/${totalPages} 页...`)

      for (let page = 2; page <= totalPages; page++) {
        try {
          const result = await getFavourites(page, source)
          if (result.needsLogin) {
            setNeedsLogin(true)
            setStatus('done')
            return
          }
          allComics.push(...result.comics)
          setProgress(`正在获取第 ${page}/${totalPages} 页...`)
        } catch {
          localSkippedPages++
          setSkippedPages(localSkippedPages)
        }
      }

      setTotalFetched(allComics.length)
      console.info('[missing-chapters] 收藏夹拉取完成', {
        source,
        totalComics: allComics.length,
        totalPages,
        skippedPages: localSkippedPages,
      })
      setStatus('computing')
      setProgress('正在计算相似度...')

      // 聚类复用 findDuplicateGroups（spec 需求 3）
      // v2：展示所有组，不再过滤"有缺失的组"——让用户自己判断
      const duplicateGroups = findDuplicateGroups(allComics)
      console.info('[missing-chapters] 聚类完成', {
        source,
        totalGroups: duplicateGroups.length,
        groupSizes: duplicateGroups.map(g => g.comics.length),
      })
      setGroups(duplicateGroups)
      // 持久化到 store：跨页面（跳搜索后返回）不丢失
      setResult(source, {
        groups: duplicateGroups,
        totalFetched: allComics.length,
        skippedPages: localSkippedPages,
      })
      setStatus('done')

      // 静默填充：对 memberCount=null 的条目，若本次检测到对应组，则填充当前成员数
      // （照搬重复检测的基线建立逻辑，design.md 决策同构）
      const fpToSize = new Map<string, number>()
      for (const g of duplicateGroups) fpToSize.set(groupFingerprint(g), g.comics.length)
      const entries = missingBlacklistRef.current[source as keyof typeof missingBlacklist] ?? []
      for (const entry of entries) {
        if (entry.memberCount === null && fpToSize.has(entry.fingerprint)) {
          confirmMissingMemberCount(source, entry.fingerprint, fpToSize.get(entry.fingerprint)!)
        }
      }
    } catch {
      setError('获取收藏数据失败，请检查登录状态和网络连接')
      setStatus('done')
    }
  }, [getFavourites, source, setResult, confirmMissingMemberCount])

  return (
    <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
        <h3 className="text-base font-medium text-[var(--text-primary)]">查缺补漏</h3>
        <button
          onClick={() => setManagerOpen(true)}
          className="relative px-3 py-1 text-xs rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                     text-[var(--text-primary)] hover:bg-[var(--border)] transition-colors"
          title="管理已忽略的同系列组"
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
        把收藏夹中标题相似（疑似同系列）的漫画聚合展示，方便你核对是否漏收。
        点击「搜索此系列」可跳到搜索页用作品名搜索，在结果里找补漏的。
      </p>

      <div className="flex items-center gap-3">
        <select
          value={source}
          onChange={e => handleSourceChange(e.target.value)}
          disabled={status === 'fetching' || status === 'computing'}
          className="px-3 py-1.5 text-sm bg-[var(--bg-secondary)] border border-[var(--border)]
                     rounded-lg text-[var(--text-primary)]"
        >
          {SOURCES_WITH_FAVOURITES.map(s => (
            <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
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

        {status === 'done' && !needsLogin && totalFetched > 0 && (
          <span className="text-sm text-[var(--text-secondary)]">
            已分析 {totalFetched} 本漫画，发现 {groups.length} 组同系列收藏
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

      {needsLogin && (
        <p className="text-sm text-yellow-600 py-2">请先登录当前来源</p>
      )}

      {skippedPages > 0 && (
        <p className="text-sm text-yellow-600 py-2">
          警告：{skippedPages} 页数据获取失败，结果可能不完整
        </p>
      )}

      {status === 'done' && !needsLogin && groups.length === 0 && totalFetched > 0 && (
        <p className="text-sm text-[var(--text-secondary)] py-4 text-center">
          未发现疑似同系列的收藏
        </p>
      )}

      {groups.length > 0 && (
        <>
          {/* 免责声明（spec 需求 8）：同系列判定基于标题相似度推测 */}
          <p className="text-xs text-[var(--text-secondary)] italic">
            ⚠ 同系列判定基于标题相似度推测，非站点权威信息；是否漏收请自行核对
          </p>
          {activeGroups.length > 0 && (
            <div className="space-y-3">
              {activeGroups.map(({ group, fingerprint, index }) => (
                <MissingGroup
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
                  <MissingGroup
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
        </>
      )}

      {managerOpen && (
        <MissingBlacklistManager
          defaultSource={source}
          fingerprintToSize={fingerprintToSize}
          onClose={() => setManagerOpen(false)}
        />
      )}
    </div>
  )
}
