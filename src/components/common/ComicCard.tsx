import { ComicInfo } from '@shared/types'
import { useSettingsStore } from '../../stores/useSettingsStore'

interface ComicCardProps {
  comic: ComicInfo
  onClick?: (comic: ComicInfo) => void
}

export function ComicCard({ comic, onClick }: ComicCardProps) {
  const { cardStyle } = useSettingsStore()

  if (cardStyle === 'detailed') {
    return <DetailedCard comic={comic} onClick={onClick} />
  }
  return <CoverCard comic={comic} onClick={onClick} />
}

function CoverCard({ comic, onClick }: ComicCardProps) {
  return (
    <div
      onClick={() => onClick?.(comic)}
      className="bg-[var(--bg-primary)] rounded-xl shadow-sm hover:shadow-md transition-all duration-200 
                 cursor-pointer overflow-hidden group"
    >
      <div className="aspect-[3/4] bg-[var(--bg-secondary)] relative overflow-hidden">
        {comic.coverUrl ? (
          <img
            src={comic.coverUrl}
            alt={comic.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[var(--text-secondary)]">
            📖
          </div>
        )}
      </div>
      <div className="p-3">
        <h3 className="text-sm font-medium text-[var(--text-primary)] truncate">
          {comic.title}
        </h3>
        {comic.author && (
          <p className="text-xs text-[var(--text-secondary)] mt-1 truncate">
            {comic.author}
          </p>
        )}
      </div>
    </div>
  )
}

function DetailedCard({ comic, onClick }: ComicCardProps) {
  return (
    <div
      onClick={() => onClick?.(comic)}
      className="bg-[var(--bg-primary)] rounded-xl shadow-sm hover:shadow-md transition-all duration-200 
                 cursor-pointer overflow-hidden flex"
    >
      <div className="w-20 h-20 bg-[var(--bg-secondary)] flex-shrink-0">
        {comic.coverUrl ? (
          <img
            src={comic.coverUrl}
            alt={comic.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[var(--text-secondary)]">
            📖
          </div>
        )}
      </div>
      <div className="flex-1 p-3 flex flex-col justify-center">
        <h3 className="text-sm font-medium text-[var(--text-primary)]">
          {comic.title}
        </h3>
        <div className="flex flex-wrap gap-1 mt-2">
          {comic.tags?.slice(0, 3).map((tag, i) => (
            <span
              key={i}
              className="text-xs px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)]"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
