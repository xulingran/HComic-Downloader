import { useState, useRef } from 'react'
import { ComicInfo } from '@shared/types'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useCoverImage } from '../../hooks/useCoverImage'

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
  const [titleExpanded, setTitleExpanded] = useState(false)

  if (cardStyle === 'detailed') {
    return <DetailedCard comic={comic} onClick={onClick} selected={selected} batchMode={batchMode} onToggleSelect={onToggleSelect} onDownload={onDownload} titleExpanded={titleExpanded} onToggleTitle={() => setTitleExpanded(!titleExpanded)} />
  }
  return <CoverCard comic={comic} onClick={onClick} selected={selected} batchMode={batchMode} onToggleSelect={onToggleSelect} onDownload={onDownload} titleExpanded={titleExpanded} onToggleTitle={() => setTitleExpanded(!titleExpanded)} />
}

function CoverCard({ comic, onClick, selected, batchMode, onToggleSelect, onDownload, titleExpanded, onToggleTitle }: ComicCardProps & { titleExpanded: boolean; onToggleTitle: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { coverSrc, retry } = useCoverImage(comic.coverUrl, containerRef)
  const handleClick = () => {
    if (batchMode) onToggleSelect?.(comic)
    else onClick?.(comic)
  }

  return (
    <div
      ref={containerRef}
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
        {coverSrc === undefined && comic.coverUrl ? (
          <div className="w-full h-full flex items-center justify-center text-[var(--text-secondary)]">
            <svg className="animate-spin h-6 w-6" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : coverSrc ? (
          <img
            src={coverSrc}
            alt={comic.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : comic.coverUrl ? (
          <div className="w-full h-full flex flex-col items-center justify-center text-[var(--text-secondary)] gap-1">
            <span className="text-xs">加载失败</span>
            <button
              onClick={(e) => { e.stopPropagation(); retry() }}
              className="text-xs px-2 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20"
            >
              重试
            </button>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[var(--text-secondary)]">
            📖
          </div>
        )}
      </div>
      <div className="p-3">
        <h3
          onClick={(e) => { e.stopPropagation(); onToggleTitle() }}
          className={`text-sm font-medium text-[var(--text-primary)] cursor-pointer select-text
                     ${titleExpanded ? '' : 'line-clamp-2'}`}
          title={comic.title}
        >
          {comic.title}
        </h3>
        {comic.author && (
          <p className="text-xs text-[var(--text-secondary)] mt-1 truncate select-text">
            {comic.author}
          </p>
        )}
      </div>
    </div>
  )
}

function DetailedCard({ comic, onClick, selected, batchMode, onToggleSelect, onDownload, titleExpanded, onToggleTitle }: ComicCardProps & { titleExpanded: boolean; onToggleTitle: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { coverSrc, retry } = useCoverImage(comic.coverUrl, containerRef)
  const [showAllTags, setShowAllTags] = useState(false)
  const handleClick = () => {
    if (batchMode) onToggleSelect?.(comic)
    else onClick?.(comic)
  }

  return (
    <div
      ref={containerRef}
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
        {coverSrc === undefined && comic.coverUrl ? (
          <div className="w-full h-full flex items-center justify-center text-[var(--text-secondary)]">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : coverSrc ? (
          <img
            src={coverSrc}
            alt={comic.title}
            className="w-full h-full object-cover"
          />
        ) : comic.coverUrl ? (
          <div className="w-full h-full flex flex-col items-center justify-center text-[var(--text-secondary)] gap-0.5">
            <span className="text-[10px]">加载失败</span>
            <button
              onClick={(e) => { e.stopPropagation(); retry() }}
              className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20"
            >
              重试
            </button>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[var(--text-secondary)]">
            📖
          </div>
        )}
      </div>
      <div className="flex-1 p-3 flex flex-col justify-center min-w-0">
        <h3
          onClick={(e) => { e.stopPropagation(); onToggleTitle() }}
          className={`text-sm font-medium text-[var(--text-primary)] cursor-pointer select-text
                     ${titleExpanded ? '' : 'line-clamp-2'}`}
          title={comic.title}
        >
          {comic.title}
        </h3>
        {comic.author && (
          <p className="text-xs text-[var(--text-secondary)] mt-1 truncate select-text">{comic.author}</p>
        )}
        {comic.pages != null && comic.pages > 0 && (
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">{comic.pages} 页</p>
        )}
        {comic.tags && comic.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {(showAllTags ? comic.tags : comic.tags.slice(0, 3)).map((tag, i) => (
              <span
                key={i}
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)]"
              >
                {tag}
              </span>
            ))}
            {comic.tags.length > 3 && !showAllTags && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowAllTags(true) }}
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                +{comic.tags.length - 3}
              </button>
            )}
            {showAllTags && comic.tags.length > 3 && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowAllTags(false) }}
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                收起
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
