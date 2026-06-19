import { useState, useEffect, useCallback } from 'react'
import { useBikaCategories } from '../hooks/useIpc'
import { useSettingsStore } from '../stores/useSettingsStore'

interface BikaCategory {
  id: string
  title: string
  thumb: string
}

interface BikaCategoryGridProps {
  onSelectCategory: (title: string) => void
}

export function BikaCategoryGrid({ onSelectCategory }: BikaCategoryGridProps) {
  const [categories, setCategories] = useState<BikaCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const { getBikaCategories } = useBikaCategories()
  const sfwMode = useSettingsStore((s) => s.sfwMode)

  useEffect(() => {
    let cancelled = false
    getBikaCategories()
      .then((result) => {
        if (!cancelled) {
          setCategories(result.categories)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载分类失败')
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [getBikaCategories, retryKey])

  const handleRetry = useCallback(() => setRetryKey((k) => k + 1), [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-[var(--text-secondary)] mb-3">{error}</div>
        <button
          onClick={handleRetry}
          className="px-4 py-2 text-sm bg-[var(--bg-secondary)] rounded-lg hover:bg-[var(--bg-primary)] transition-colors"
        >
          重试
        </button>
      </div>
    )
  }

  if (categories.length === 0) {
    return <div className="text-center py-12 text-[var(--text-secondary)]">暂无分类</div>
  }

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
      {categories.map((cat) => {
        const showImage = cat.thumb && !sfwMode
        return (
          <button
            key={cat.id || cat.title}
            onClick={() => onSelectCategory(cat.title)}
            className="group relative aspect-square rounded-lg overflow-hidden bg-[var(--bg-secondary)]
                       hover:ring-2 hover:ring-[var(--accent)] transition-[box-shadow,--tw-ring-color] duration-200"
          >
            {showImage ? (
              <>
                <img
                  src={cat.thumb}
                  alt={cat.title}
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-200"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                <span className="absolute bottom-0 left-0 right-0 px-1.5 py-2 text-white text-xs font-medium truncate text-center">
                  {cat.title}
                </span>
              </>
            ) : (
              <div className="flex items-center justify-center w-full h-full">
                <span className="text-[var(--text-primary)] text-xs font-medium px-2 text-center">
                  {cat.title}
                </span>
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}
