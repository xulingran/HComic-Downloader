import { useEffect, useState, useCallback } from 'react'
import { SearchMode } from '@shared/types'
import { useDrawerStore } from '../stores/useDrawerStore'

export function ComicInfoDrawer() {
  const { drawerComic, isOpen, closeDrawer, setPendingSearch } = useDrawerStore()
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)

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

  const handleSearch = (query: string, mode: SearchMode) => {
    setPendingSearch(query, mode)
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
                {drawerComic.tags.map((tag, i) => (
                  <button
                    key={i}
                    onClick={() => handleSearch(tag, 'tag')}
                    className="text-xs px-2.5 py-1 rounded-full bg-[var(--accent)]/10
                               text-[var(--accent)] cursor-pointer
                               hover:bg-[var(--accent)]/20 transition-colors"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
