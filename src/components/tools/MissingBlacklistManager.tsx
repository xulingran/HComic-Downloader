import { useState, useMemo } from 'react'
import { SOURCES_WITH_FAVOURITES, SOURCE_LABELS } from '@shared/types'
import type { DuplicateBlacklistEntry } from '@shared/types'
import { useSettingsStore } from '@/stores/useSettingsStore'

interface MissingBlacklistManagerProps {
  /** 弹窗默认选中的来源（通常与检测来源一致） */
  defaultSource?: string
  /** 指纹 → 当前检测到的组成员数（用于判断变动）；无检测结果时传空 Map */
  fingerprintToSize: Map<string, number>
  onClose: () => void
}

/**
 * 查缺补漏「管理已忽略」面板。
 *
 * 照搬 DuplicateBlacklistManager 的范式（弹窗 + 来源 tab + 列表 + 逐项移除），
 * 但操作独立的 missingBlacklist 配置字段。成员变动检测逻辑同构：
 * memberCount 非 null 且与当前组大小不等 → 标记变动，提供「确认」按钮。
 */
export function MissingBlacklistManager({
  defaultSource = 'hcomic',
  fingerprintToSize,
  onClose,
}: MissingBlacklistManagerProps) {
  const missingBlacklist = useSettingsStore(s => s.missingBlacklist)
  const removeMissingIgnore = useSettingsStore(s => s.removeMissingIgnore)
  const confirmMissingMemberCount = useSettingsStore(s => s.confirmMissingMemberCount)

  const sources = useMemo(() =>
    SOURCES_WITH_FAVOURITES.map(s => ({ value: s, label: SOURCE_LABELS[s] })),
  [])
  const [activeSource, setActiveSource] = useState<string>(
    sources.some(s => s.value === defaultSource) ? defaultSource : sources[0]?.value ?? 'hcomic'
  )

  const entries: DuplicateBlacklistEntry[] = missingBlacklist[activeSource] ?? []

  // 判断某条目是否为"变动"状态：memberCount 非 null 且与当前组大小不等
  const isChanged = (entry: DuplicateBlacklistEntry): boolean => {
    if (entry.memberCount === null) return false
    const current = fingerprintToSize.get(entry.fingerprint)
    return current !== undefined && current !== entry.memberCount
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-lg max-w-md w-full mx-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-medium text-[var(--text-primary)]">已忽略的同系列组</h3>
          <button
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title="关闭"
          >
            ✕
          </button>
        </div>

        <div className="flex gap-2 mb-4 flex-wrap">
          {sources.map(s => {
            const count = missingBlacklist[s.value]?.length ?? 0
            return (
              <button
                key={s.value}
                onClick={() => setActiveSource(s.value)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  activeSource === s.value
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)]'
                }`}
              >
                {s.label}
                {count > 0 && <span className="ml-1.5 text-xs opacity-80">({count})</span>}
              </button>
            )
          })}
        </div>

        {entries.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)] py-8 text-center">
            暂无已忽略的同系列组
          </p>
        ) : (
          <div className="max-h-80 overflow-y-auto space-y-1">
            {entries.map(entry => {
              const changed = isChanged(entry)
              const currentSize = fingerprintToSize.get(entry.fingerprint)
              return (
                <div
                  key={entry.fingerprint}
                  className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg
                             transition-colors border-l-2 ${
                               changed
                                 ? 'bg-[var(--bg-secondary)] border-l-amber-500'
                                 : 'bg-[var(--bg-secondary)] border-l-transparent hover:bg-[var(--border)]'
                             }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-[var(--text-primary)] break-all">
                      {entry.fingerprint}
                    </div>
                    {changed ? (
                      <div className="text-xs text-amber-600 mt-0.5">
                        成员数变化：{entry.memberCount} → {currentSize}
                      </div>
                    ) : (
                      <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                        {entry.memberCount === null
                          ? `${currentSize ?? '?'} 本（基线未建立）`
                          : `${entry.memberCount} 本`}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {changed && (
                      <button
                        onClick={() => confirmMissingMemberCount(activeSource, entry.fingerprint, currentSize!)}
                        className="px-2 py-1 text-xs rounded bg-amber-500/20 text-amber-600
                                   hover:bg-amber-500 hover:text-white transition-colors"
                        title="确认当前成员数，清除变动提示"
                      >
                        确认
                      </button>
                    )}
                    <button
                      onClick={() => removeMissingIgnore(activeSource, entry.fingerprint)}
                      className="w-5 h-5 rounded-full text-xs flex items-center justify-center
                                 text-[var(--text-secondary)] hover:text-[var(--error)] hover:bg-[var(--error)]/10
                                 transition-colors"
                      title="取消忽略"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <p className="mt-4 text-xs text-[var(--text-secondary)] text-center">
          取消忽略后，该组将在下次检测时恢复默认展开
        </p>
      </div>
    </div>
  )
}
