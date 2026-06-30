import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { TAG_RECOMMENDATION_SOURCES, SOURCE_LABELS, FavouriteTagsProgressEvent } from '@shared/types'
import { useFavouriteTags, useFavouriteTagsProgress } from '../../hooks/useIpc'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { normalizeSourceKey } from '../../utils/source'

interface TagItem {
  tag: string
  count: number
}

export function FavouriteTagSettings() {
  const {
    favouriteTagHighlight, setFavouriteTagHighlight,
    favouriteTagMinMatches, setFavouriteTagMinMatches,
    myTags, addMyTag, removeMyTag,
    tagBlacklist,
  } = useSettingsStore()
  const { getFavouriteTags, syncFavouriteTags } = useFavouriteTags()
  const [source, setSource] = useState('hcomic')
  // 检测标签候选池（来自 favourite_tag_index，仅展示与挑选，不直接生效）
  const [detectedTags, setDetectedTags] = useState<TagItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncedCount, setSyncedCount] = useState<number | null>(null)
  const [showAllDetected, setShowAllDetected] = useState(false)
  const [manualInput, setManualInput] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)
  // 标签操作提示：message 与 visible 拆分。
  // 计时器由 timer ref 持有并在每次 showToast 时重置（连续触发不互相提前关闭），
  // 卸载时 effect cleanup 清掉 ref，避免组件卸载后 setState（与 ComicInfoDrawer 的 toast 模式一致）。
  const [opToastMessage, setOpToastMessage] = useState('')
  const [showOpToast, setShowOpToast] = useState(false)
  const opToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sourceKey = normalizeSourceKey(source)
  const myTagList = myTags[sourceKey] ?? []
  const blacklistSet = new Set(tagBlacklist[sourceKey].map(t => t.toLowerCase()))
  const myTagSet = new Set(myTagList.map(t => t.toLowerCase()))

  // 同步进度按来源订阅，避免不同来源切换时串显示；
  // 同步未进行时 progress 用于在按钮旁展示上一帧完成/错误状态。
  const { progress: syncProgress, clear: clearSyncProgress } = useFavouriteTagsProgress(source)

  const syncLabel = useMemo(() => formatSyncLabel(syncProgress), [syncProgress])

  const loadDetectedTags = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = await getFavouriteTags(source)
      setDetectedTags(result.tags)
    } catch {
      setDetectedTags([])
    } finally {
      setIsLoading(false)
    }
  }, [getFavouriteTags, source])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDetectedTags()
  }, [loadDetectedTags])

  const handleSync = async () => {
    setIsSyncing(true)
    setSyncedCount(null)
    clearSyncProgress()
    try {
      const result = await syncFavouriteTags(source)
      setSyncedCount(result.totalComics)
      setDetectedTags(result.tags)
    } catch {
      setSyncedCount(null)
    } finally {
      setIsSyncing(false)
    }
  }

  // showToast 刷新文案并重置计时器：连续触发时先清旧 timer 再起 2500ms 新 timer，
  // 确保第二条提示不被第一条的计时器提前关闭（旧实现依赖 [showOpToast] effect，
  // 但 true→true 不重渲染、effect 不重跑，导致连续 toast 提前消失）。
  const showToast = (msg: string) => {
    setOpToastMessage(msg)
    setShowOpToast(true)
    if (opToastTimerRef.current) clearTimeout(opToastTimerRef.current)
    opToastTimerRef.current = setTimeout(() => setShowOpToast(false), 2500)
  }

  useEffect(() => {
    return () => {
      if (opToastTimerRef.current) clearTimeout(opToastTimerRef.current)
    }
  }, [])

  const handleAddManual = () => {
    const trimmed = manualInput.trim()
    if (!trimmed) {
      setInputError('标签不能为空')
      return
    }
    const ok = addMyTag(source, trimmed)
    if (!ok) {
      // 区分重复与互斥冲突
      if (myTagSet.has(trimmed.toLowerCase())) {
        setInputError('该标签已在推荐列表中')
      } else if (blacklistSet.has(trimmed.toLowerCase())) {
        setInputError('该标签已被屏蔽，请先取消屏蔽')
      } else {
        setInputError('添加失败（可能超过长度限制）')
      }
      return
    }
    setManualInput('')
    setInputError(null)
    showToast(`已加入推荐：${trimmed}`)
  }

  const handleRemoveMyTag = (tag: string) => {
    removeMyTag(source, tag)
    showToast(`已移除推荐：${tag}`)
  }

  const handlePickDetected = (tag: string) => {
    const ok = addMyTag(source, tag)
    if (!ok) {
      if (blacklistSet.has(tag.toLowerCase())) {
        showToast(`「${tag}」已被屏蔽，请先取消屏蔽`)
      }
      return
    }
    showToast(`已加入推荐：${tag}`)
  }

  const handleToggle = () => {
    setFavouriteTagHighlight(!favouriteTagHighlight)
  }

  return (
    <div id="section-favourite-tags" className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm space-y-6">
      <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
        <h3 className="text-base font-medium text-[var(--text-primary)]">推荐标签</h3>
        <button
          onClick={handleToggle}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            favouriteTagHighlight ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              favouriteTagHighlight ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      <p className="text-sm text-[var(--text-secondary)]">
        手动收藏你感兴趣的标签，搜索结果中命中推荐标签的漫画会被高亮显示。也可从下方「检测标签」候选池一键挑选。
      </p>

      <div className="flex items-center gap-3">
        <span className="text-sm text-[var(--text-secondary)]">最少命中标签数</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setFavouriteTagMinMatches(Math.max(1, favouriteTagMinMatches - 1))}
            disabled={favouriteTagMinMatches <= 1}
            className="w-7 h-7 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)]
                       text-[var(--text-primary)] flex items-center justify-center
                       disabled:opacity-30 hover:bg-[var(--bg-tertiary)] transition-colors text-sm"
          >
            −
          </button>
          <span className="w-8 text-center text-sm font-medium text-[var(--text-primary)] tabular-nums">
            {favouriteTagMinMatches}
          </span>
          <button
            onClick={() => setFavouriteTagMinMatches(Math.min(10, favouriteTagMinMatches + 1))}
            disabled={favouriteTagMinMatches >= 10}
            className="w-7 h-7 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)]
                       text-[var(--text-primary)] flex items-center justify-center
                       disabled:opacity-30 hover:bg-[var(--bg-tertiary)] transition-colors text-sm"
          >
            +
          </button>
        </div>
        <span className="text-xs text-[var(--text-secondary)]">
          漫画命中推荐标签数 ≥ 该值时才高亮
        </span>
      </div>

      <div className="flex items-center gap-3">
        <select
          value={source}
          onChange={e => setSource(e.target.value)}
          disabled={isSyncing}
          className="px-3 py-1.5 text-sm bg-[var(--bg-secondary)] border border-[var(--border)]
                     rounded-lg text-[var(--text-primary)]"
        >
          {TAG_RECOMMENDATION_SOURCES.map(s => (
            <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
          ))}
        </select>
      </div>

      {/* ── 推荐标签区（my_tags，高亮生效源）── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">
            推荐标签 ({SOURCE_LABELS[sourceKey as keyof typeof SOURCE_LABELS]})
          </span>
          <span className="text-xs text-[var(--text-secondary)]">{myTagList.length} 个</span>
        </div>
        <div className="flex flex-wrap gap-2 min-h-[2rem]">
          {myTagList.length === 0 ? (
            <span className="text-xs text-[var(--text-secondary)] italic py-1">
              暂无推荐标签，可手动添加或从下方检测标签挑选
            </span>
          ) : (
            myTagList.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full
                           bg-amber-500/15 text-amber-600 text-sm"
              >
                ★ {tag}
                <button
                  onClick={() => handleRemoveMyTag(tag)}
                  className="w-4 h-4 rounded-full text-[10px] flex items-center justify-center
                             text-amber-600/60 hover:text-[var(--error)] hover:bg-[var(--error)]/10 transition-colors"
                  title="移除推荐"
                >
                  ✕
                </button>
              </span>
            ))
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={manualInput}
            onChange={e => { setManualInput(e.target.value); setInputError(null) }}
            onKeyDown={e => { if (e.key === 'Enter') handleAddManual() }}
            placeholder="手动添加标签名（可添加 sync 未检测到的标签）"
            maxLength={64}
            className="flex-1 px-3 py-1.5 text-sm bg-[var(--bg-secondary)] border border-[var(--border)]
                       rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/60"
          />
          <button
            onClick={handleAddManual}
            className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-sm
                       hover:bg-amber-600 transition-colors"
          >
            添加
          </button>
        </div>
        {inputError && (
          <p className="text-xs text-[var(--error)]">{inputError}</p>
        )}
      </div>

      {/* ── 检测标签区（候选池，来自 favourite_tag_index，仅供挑选）── */}
      <div className="space-y-2 border-t border-[var(--border)] pt-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">
            检测标签（候选池）
          </span>
          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="px-3 py-1 rounded-lg bg-[var(--accent)]/10 text-[var(--accent)] text-xs
                       disabled:opacity-50 hover:bg-[var(--accent)]/20 transition-colors"
          >
            {isSyncing ? (syncLabel ?? '同步中...') : '从收藏夹同步'}
          </button>
        </div>
        <p className="text-xs text-[var(--text-secondary)]">
          基于收藏夹漫画统计的高频标签，点击挑选加入推荐。
          {syncedCount !== null && <span className="ml-1">已同步 {syncedCount} 本漫画。</span>}
          {!isSyncing && syncProgress?.phase === 'error' && syncProgress.message && (
            <span className="ml-1 text-[var(--error)]">同步出错：{syncProgress.message}</span>
          )}
        </p>
        {isLoading ? (
          <p className="text-sm text-[var(--text-secondary)] py-4 text-center">加载中...</p>
        ) : detectedTags.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)] py-4 text-center">
            请先同步收藏夹以生成检测标签
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 max-h-52 overflow-y-auto content-start">
              {detectedTags.slice(0, 10).map(({ tag, count }) => (
                <DetectedTagChip
                  key={tag}
                  tag={tag}
                  count={count}
                  picked={myTagSet.has(tag.toLowerCase())}
                  blacklisted={blacklistSet.has(tag.toLowerCase())}
                  onPick={handlePickDetected}
                  onRemove={handleRemoveMyTag}
                />
              ))}
            </div>
            {detectedTags.length > 10 && (
              <button
                onClick={() => setShowAllDetected(true)}
                className="text-sm text-[var(--accent)] hover:underline"
              >
                管理全部检测标签 (共 {detectedTags.length} 个)
              </button>
            )}
          </>
        )}
      </div>

      {/* ── 全部检测标签弹窗 ── */}
      {showAllDetected && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={() => setShowAllDetected(false)}>
          <div
            className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-lg max-w-lg w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-medium text-[var(--text-primary)]">
                全部检测标签 ({SOURCE_LABELS[sourceKey as keyof typeof SOURCE_LABELS]})
              </h3>
              <button
                onClick={() => setShowAllDetected(false)}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-lg leading-none"
              >
                ✕
              </button>
            </div>
            <div className="flex flex-wrap gap-2 max-h-[60vh] overflow-y-auto content-start">
              {detectedTags.map(({ tag, count }) => (
                <DetectedTagChip
                  key={tag}
                  tag={tag}
                  count={count}
                  picked={myTagSet.has(tag.toLowerCase())}
                  blacklisted={blacklistSet.has(tag.toLowerCase())}
                  onPick={handlePickDetected}
                  onRemove={handleRemoveMyTag}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {showOpToast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg
                        bg-[var(--bg-tertiary)] text-[var(--text-primary)] text-sm shadow-lg border border-[var(--border)]">
          {opToastMessage}
        </div>
      )}
    </div>
  )
}

/**
 * 检测标签三态 chip：已选（点击移除）/ 已屏蔽（禁用）/ 可选（点击加入推荐）。
 * inline slice(0,10) 区与「全部检测标签」弹窗共用，消除两处渲染重复。
 * 根元素必须为 <button>（测试通过 closest('button') 定位）；保留 disabled + line-through + ✓ 标记。
 */
interface DetectedTagChipProps {
  tag: string
  count: number
  picked: boolean
  blacklisted: boolean
  onPick: (tag: string) => void
  onRemove: (tag: string) => void
}

function DetectedTagChip({ tag, count, picked, blacklisted, onPick, onRemove }: DetectedTagChipProps) {
  return (
    <button
      key={tag}
      onClick={() => (picked ? onRemove(tag) : onPick(tag))}
      disabled={!picked && blacklisted}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors ${
        picked
          ? 'bg-amber-500/15 text-amber-600/60 cursor-pointer opacity-60'
          : blacklisted
            ? 'bg-[var(--error)]/5 text-[var(--text-secondary)]/40 cursor-not-allowed line-through'
            : 'bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 cursor-pointer'
      }`}
      title={picked ? '已加入推荐，点击移除' : blacklisted ? '该标签已被屏蔽' : '点击加入推荐'}
    >
      {picked && '✓ '}{tag}
      <span className="text-xs opacity-60">({count})</span>
    </button>
  )
}

/** 根据同步进度阶段生成按钮文案，返回 null 表示使用兜底「同步中...」。 */
function formatSyncLabel(progress: FavouriteTagsProgressEvent | null): string | null {
  if (!progress) return null
  switch (progress.phase) {
    case 'fetching': {
      const totalPages = progress.totalPages ?? progress.total
      const page = progress.currentPage ?? progress.current
      const comicsSuffix = progress.totalComics != null ? `，已扫描 ${progress.totalComics} 本` : ''
      return totalPages > 0 ? `同步收藏夹 ${page}/${totalPages} 页${comicsSuffix}` : '同步收藏夹...'
    }
    case 'enriching': {
      const total = progress.total
      const current = progress.current
      return total > 0 ? `补全标签 ${current}/${total}` : '补全标签...'
    }
    case 'completed':
      return '同步完成'
    case 'error':
      return '同步出错'
    default:
      return null
  }
}
