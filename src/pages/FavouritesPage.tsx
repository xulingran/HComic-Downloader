import { useState, useEffect } from 'react'
import { useFavourites } from '../hooks/useIpc'
import { ComicCard } from '../components/common/ComicCard'
import { ComicInfo } from '@shared/types'

export function FavouritesPage() {
  const [comics, setComics] = useState<ComicInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { getFavourites } = useFavourites()

  useEffect(() => {
    loadFavourites()
  }, [])

  const loadFavourites = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await getFavourites()
      setComics(result.comics)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load favourites')
    } finally {
      setIsLoading(false)
    }
  }

  const handleComicClick = (comic: ComicInfo) => {
    console.log('Favourite clicked:', comic)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-[var(--text-secondary)]">加载中...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 bg-[var(--error)]/10 text-[var(--error)] rounded-lg">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          收藏夹
        </h2>
        <button
          onClick={loadFavourites}
          className="px-3 py-1 text-sm bg-[var(--bg-primary)] border border-[var(--border)] 
                     rounded-lg hover:bg-[var(--bg-secondary)] transition-colors"
        >
          刷新
        </button>
      </div>

      {comics.length === 0 ? (
        <div className="text-center text-[var(--text-secondary)] py-12">
          暂无收藏
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {comics.map((comic) => (
            <ComicCard key={comic.id} comic={comic} onClick={handleComicClick} />
          ))}
        </div>
      )}
    </div>
  )
}
