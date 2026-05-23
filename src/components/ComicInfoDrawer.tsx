import { useEffect, useState, useCallback } from 'react'
import { SearchMode } from '@shared/types'
import { useDrawerStore } from '../stores/useDrawerStore'
import { useSettingsStore } from '../stores/useSettingsStore'

export function ComicInfoDrawer() {
  const { drawerComic, isOpen, closeDrawer, setPendingSearch } = useDrawerStore()
  const { tagBlacklist, addTag, removeTag } = useSettingsStore()
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [confirmTag, setConfirmTag] = useState<{ tag: string; action: 'block' | 'unblock' } | null>(null)

  const comicSource = drawerComic?.source || 'hcomic'

  const isTagBlocked = (tag: string) => {
    const key = (comicSource === 'moeimg' ? 'moeimg' : 'hcomic') as 'hcomic' | 'moeimg'
    return tagBlacklist[key].some(t => t.toLowerCase() === tag.toLowerCase())
  }

  useEffect(() => {
    if (isOpen) {
      setMounted(true)
      requestAnimationFrame(() => setVisible(true))
    } else {
      setVisible(false)
    }
  }, [isOpen])

  const handleTransitionEnd = useCallback(() => {
    if (!visible) {
      setMounted(false)
    }
  }, [visible])

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDrawer()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, closeDrawer])

  if (!mounted) return null

  const handleSearch = (query: string, mode: SearchMode, append = false) => {
    setPendingSearch(query, mode, append)
    closeDrawer()
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className={`absolute inset-0 transition-opacity duration-300 ${
          visible ? 'bg-black/50' : 'bg-black/0'
        }`}
        onClick={closeDrawer}
      />
      <div
        onTransitionEnd={handleTransitionEnd}
        className={`relative w-80 max-w-[85vw] bg-[var(--bg-primary)] shadow-2xl
                    flex flex-col overflow-y-auto
                    transition-transform duration-300 ease-out ${
                      visible ? 'translate-x-0' : 'translate-x-full'
                    }`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <span className="text-sm text-[var(--text-secondary)]">漫画详情</span>
          <button
            onClick={closeDrawer}
            className="w-7 h-7 flex items-center justify-center rounded-md
                       text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]
                       hover:text-[var(--text-primary)] transition-colors text-lg"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <h3 className="text-base font-medium text-[var(--text-primary)] leading-relaxed select-text">
            {drawerComic?.title}
          </h3>

          {drawerComic?.author ? (
            <div>
              <span className="text-xs text-[var(--text-secondary)]">作者</span>
              <button
                onClick={() => handleSearch(drawerComic.author!, 'author')}
                className="block text-sm text-[var(--accent)] mt-0.5 cursor-pointer
                           hover:underline select-text text-left"
              >
                {drawerComic.author}
              </button>
            </div>
          ) : (
            <div>
              <span className="text-xs text-[var(--text-secondary)]">作者</span>
              <p className="text-sm text-[var(--text-secondary)] mt-0.5">未知作者</p>
            </div>
          )}

          <div>
            <span className="text-xs text-[var(--text-secondary)]">信息</span>
            <p className="text-sm text-[var(--text-primary)] mt-0.5 select-text">
              {drawerComic?.sourceSite || drawerComic?.source}
              {drawerComic?.pages != null && drawerComic.pages > 0 && (
                <> · {drawerComic.pages} 页</>
              )}
            </p>
          </div>

          {drawerComic?.tags && drawerComic.tags.length > 0 && (
            <div>
              <span className="text-xs text-[var(--text-secondary)]">标签</span>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {drawerComic.tags.map((tag, i) => {
                  const blocked = isTagBlocked(tag)
                  return (
                    <span key={i} className="relative group">
                      <button
                        onClick={() => handleSearch(tag, 'tag', true)}
                        className={`text-xs px-2.5 py-1 rounded-full cursor-pointer transition-colors ${
                          blocked
                            ? 'bg-[var(--error)]/10 text-[var(--error)] line-through opacity-60'
                            : 'bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20'
                        }`}
                      >
                        {tag}
                      </button>
                      <button
                        onClick={() => setConfirmTag({ tag, action: blocked ? 'unblock' : 'block' })}
                        className={`absolute -top-1 -right-1 w-4 h-4 rounded-full text-[10px] flex items-center justify-center
                                   opacity-0 group-hover:opacity-100 transition-opacity
                                   ${blocked
                                     ? 'bg-[var(--accent)] text-white'
                                     : 'bg-[var(--error)] text-white'
                                   }`}
                        title={blocked ? '取消屏蔽' : '屏蔽标签'}
                      >
                        {blocked ? '✓' : '×'}
                      </button>
                    </span>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {confirmTag && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center" onClick={() => setConfirmTag(null)}>
          <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-lg max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium text-[var(--text-primary)] mb-4">
              {confirmTag.action === 'block'
                ? `屏蔽标签「${confirmTag.tag}」？`
                : `取消屏蔽标签「${confirmTag.tag}」？`
              }
            </h3>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              {confirmTag.action === 'block'
                ? '包含该标签的漫画将从搜索结果中隐藏。'
                : '包含该标签的漫画将恢复显示在搜索结果中。'
              }
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmTag(null)}
                className="px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)]"
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (confirmTag.action === 'block') {
                    addTag(comicSource, confirmTag.tag)
                  } else {
                    removeTag(comicSource, confirmTag.tag)
                  }
                  setConfirmTag(null)
                }}
                className={`px-4 py-2 rounded-lg text-white ${
                  confirmTag.action === 'block'
                    ? 'bg-[var(--error)] hover:bg-[var(--error)]/80'
                    : 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]'
                }`}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
