import { ComicInfo } from '@shared/types'
import { useSettingsStore } from '../../stores/useSettingsStore'

interface ComicCardProps {
  comic: ComicInfo
  onClick?: (comic: ComicInfo) => void
  selected?: boolean
  batchMode?: boolean
  onToggleSelect?: (comic: ComicInfo) => void
  onDownload?: (comic: ComicInfo) => void
}

export function ComicCard({ comic, onClick, selected, batchMode, onToggleSelect, onDownload }: ComicCardProps) {
  const { cardStyle } = useSettingsStore()

  if (cardStyle === 'detailed') {
    return <DetailedCard comic={comic} onClick={onClick} selected={selected} batchMode={batchMode} onToggleSelect={onToggleSelect} onDownload={onDownload} />
  }
  return <CoverCard comic={comic} onClick={onClick} selected={selected} batchMode={batchMode} onToggleSelect={onToggleSelect} onDownload={onDownload} />
}

function CoverCard({ comic, onClick, selected, batchMode, onToggleSelect, onDownload }: ComicCardProps) {
  const handleClick = () => {
    if (batchMode) onToggleSelect?.(comic)
    else onClick?.(comic)
  }

  return (
    <div
      onClick={handleClick}
      className={`bg-[var(--bg-primary)] rounded-xl shadow-sm hover:shadow-md transition-all duration-200
                 cursor-pointer overflow-hidden group relative
                 ${selected ? 'ring-2 ring-[var(--accent)] shadow-[var(--accent)]/20 shadow-lg' : ''}`}
    >
      {batchMode && (
        <div className={`absolute top-2 left-2 z-10 w-5 h-5 rounded-full border-2 flex items-center justify-center
                        ${selected ? 'bg-[var(--accent)] border-[var(--accent)]' : 'border-white/80 bg-black/30'}`}>
          {selected && (
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
      )}
      {!batchMode && onDownload && (
        <button
          onClick={(e) => { e.stopPropagation(); onDownload(comic) }}
          className="absolute top-2 right-2 z-10 w-8 h-8 rounded-full bg-black/50 text-white
                     flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
      )}
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

function DetailedCard({ comic, onClick, selected, batchMode, onToggleSelect, onDownload }: ComicCardProps) {
  const handleClick = () => {
    if (batchMode) onToggleSelect?.(comic)
    else onClick?.(comic)
  }

  return (
    <div
      onClick={handleClick}
      className={`bg-[var(--bg-primary)] rounded-xl shadow-sm hover:shadow-md transition-all duration-200
                 cursor-pointer overflow-hidden flex relative
                 ${selected ? 'ring-2 ring-[var(--accent)] shadow-[var(--accent)]/20 shadow-lg' : ''}`}
    >
      {batchMode && (
        <div className={`absolute top-2 left-2 z-10 w-5 h-5 rounded-full border-2 flex items-center justify-center
                        ${selected ? 'bg-[var(--accent)] border-[var(--accent)]' : 'border-white/80 bg-black/30'}`}>
          {selected && (
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
      )}
      {!batchMode && onDownload && (
        <button
          onClick={(e) => { e.stopPropagation(); onDownload(comic) }}
          className="absolute top-2 right-2 z-10 w-8 h-8 rounded-full bg-black/50 text-white
                     flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
      )}
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
