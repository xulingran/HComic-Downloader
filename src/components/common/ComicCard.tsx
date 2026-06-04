import { useState, useRef } from 'react'
import { ComicInfo } from '@shared/types'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { useDrawerStore } from '../../stores/useDrawerStore'
import { useCoverImage } from '../../hooks/useCoverImage'
import { useCardInteraction } from '../../hooks/useCardInteraction'

interface CoverImageProps {
  coverUrl: string
  coverSrc: string | null | undefined
  sfwMode: boolean
  title: string
  retry: () => void
  downloadStatus?: 'downloaded' | 'unknown'
  variant: 'cover' | 'detailed'
  onClick: (e: React.MouseEvent) => void
}

const COVER_STYLES = {
  cover: {
    wrapper: 'w-full h-full',
    sfwIcon: 'text-3xl',
    sfwShowLabel: true,
    spinner: 'h-6 w-6',
    imgClass: 'w-full h-full object-cover group-hover:scale-105 transition-transform duration-300',
    errorText: 'text-xs',
    errorBtn: 'text-xs px-2 py-0.5',
    errorGap: 'gap-1',
    badge: {
      pos: 'top-[3%] right-[3%]',
      rounded: 'rounded-lg',
      padding: 'p-[3px] sm:p-[4px] md:p-[5px] lg:p-[6px]',
      outer: 'w-[20px] h-[20px] sm:w-[24px] sm:h-[24px] md:w-[28px] md:h-[28px] lg:w-[32px] lg:h-[32px]',
      icon: 'w-[12px] h-[12px] sm:w-[14px] sm:h-[14px] md:w-[17px] md:h-[17px] lg:w-[19px] lg:h-[19px]',
    },
  },
  detailed: {
    wrapper: 'w-14 h-14',
    sfwIcon: 'text-xl',
    sfwShowLabel: false,
    spinner: 'h-5 w-5',
    imgClass: 'w-full h-full object-cover',
    errorText: 'text-[10px]',
    errorBtn: 'text-[10px] px-1.5 py-0.5',
    errorGap: 'gap-0.5',
    badge: {
      pos: 'top-[5%] right-[5%]',
      rounded: 'rounded-md',
      padding: 'p-[2px]',
      outer: 'w-[16px] h-[16px] sm:w-[18px] sm:h-[18px]',
      icon: 'w-[10px] h-[10px] sm:w-[11px] sm:h-[11px]',
    },
  },
} as const

function CoverImage({ coverUrl, coverSrc, sfwMode, title, retry, downloadStatus, variant, onClick }: CoverImageProps) {
  const s = COVER_STYLES[variant]
  return (
    <div
      className={`bg-[var(--bg-secondary)] relative overflow-hidden ${s.wrapper}`}
      onClick={onClick}
    >
      {sfwMode ? (
        <div className="w-full h-full flex items-center justify-center text-[var(--text-secondary)]">
          <div className="flex flex-col items-center gap-1">
            <span className={s.sfwIcon}>📖</span>
            {s.sfwShowLabel && <span className="text-xs font-medium">SFW</span>}
          </div>
        </div>
      ) : coverSrc === undefined && coverUrl ? (
        <div className="w-full h-full flex items-center justify-center text-[var(--text-secondary)]">
          <svg className={`animate-spin ${s.spinner}`} viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : coverSrc ? (
        <img src={coverSrc} alt={title} className={s.imgClass} />
      ) : coverUrl ? (
        <div className={`w-full h-full flex flex-col items-center justify-center text-[var(--text-secondary)] ${s.errorGap}`}>
          <span className={s.errorText}>加载失败</span>
          <button
            onClick={(e) => { e.stopPropagation(); retry() }}
            className={`${s.errorBtn} rounded bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20`}
          >
            重试
          </button>
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[var(--text-secondary)]">
          📖
        </div>
      )}
      {downloadStatus === 'downloaded' && (
        <div className={`absolute ${s.badge.pos} z-[5] ${s.badge.rounded} bg-gray-800/60 backdrop-blur-sm ${s.badge.padding} flex items-center justify-center`}>
          <div className={`${s.badge.outer} rounded-full bg-green-500 flex items-center justify-center`}>
            <svg className={`${s.badge.icon} text-white`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
      )}
    </div>
  )
}

interface ComicCardProps {
  comic: ComicInfo
  onClick?: (comic: ComicInfo) => void
  selected?: boolean
  batchMode?: boolean
  onToggleSelect?: (comic: ComicInfo) => void
  onDownload?: (comic: ComicInfo) => void
  onOpenReader?: (comic: ComicInfo) => void
  downloadStatus?: 'downloaded' | 'unknown'
  isRecommended?: boolean
  recommendedTags?: Set<string>
}

export function ComicCard({ comic, onClick, selected, batchMode, onToggleSelect, onDownload, onOpenReader, downloadStatus, isRecommended, recommendedTags }: ComicCardProps) {
  const { cardStyle } = useSettingsStore()
  const { openDrawer } = useDrawerStore()

  if (cardStyle === 'detailed') {
    return <DetailedCard comic={comic} onClick={onClick} selected={selected} batchMode={batchMode} onToggleSelect={onToggleSelect} onDownload={onDownload} onOpenReader={onOpenReader} downloadStatus={downloadStatus} onOpenDrawer={() => openDrawer(comic)} isRecommended={isRecommended} recommendedTags={recommendedTags} />
  }
  return <CoverCard comic={comic} onClick={onClick} selected={selected} batchMode={batchMode} onToggleSelect={onToggleSelect} onDownload={onDownload} onOpenReader={onOpenReader} downloadStatus={downloadStatus} onOpenDrawer={() => openDrawer(comic)} isRecommended={isRecommended} recommendedTags={recommendedTags} />
}

function CoverCard({ comic, onClick, selected, batchMode, onToggleSelect, onDownload, onOpenReader, downloadStatus, onOpenDrawer, isRecommended }: ComicCardProps & { onOpenDrawer: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { sfwMode } = useSettingsStore()
  const { coverSrc, retry } = useCoverImage(comic.coverUrl, containerRef, sfwMode)
  const { handleCardClick, handleReaderClick, handleTitleClick } = useCardInteraction({
    comic, batchMode, sfwMode, onToggleSelect, onClick, onOpenDrawer, onOpenReader,
  })

  return (
    <div
      ref={containerRef}
      onClick={handleCardClick}
      className={`bg-[var(--bg-primary)] rounded-xl shadow-sm hover:shadow-md transition-all duration-200
                 cursor-pointer overflow-hidden group relative
                 ${selected ? 'ring-2 ring-[var(--accent)] shadow-[var(--accent)]/20 shadow-lg' : ''}
                 ${isRecommended ? 'border-l-2 border-l-amber-400/70' : ''}`}
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
      <div className="aspect-[6/7]" onClick={(e) => { e.stopPropagation(); handleReaderClick() }}>
        <CoverImage
          coverUrl={comic.coverUrl} coverSrc={coverSrc} sfwMode={sfwMode}
          title={comic.title} retry={retry} downloadStatus={downloadStatus}
          variant="cover" onClick={(e) => { e.stopPropagation(); handleReaderClick() }}
        />
      </div>
      <div className="p-2">
        <h3
          onClick={(e) => {
            e.stopPropagation()
            handleTitleClick()
          }}
          className="text-sm font-medium text-[var(--text-primary)] cursor-pointer select-text line-clamp-2"
          title={comic.title}
        >
          {comic.title}
        </h3>
        {comic.author && (
          <p className="text-xs text-[var(--text-secondary)] mt-0.5 truncate select-text">
            {comic.author}
          </p>
        )}
      </div>
    </div>
  )
}

function DetailedCard({ comic, onClick, selected, batchMode, onToggleSelect, onDownload, onOpenReader, downloadStatus, onOpenDrawer, isRecommended, recommendedTags }: ComicCardProps & { onOpenDrawer: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { sfwMode } = useSettingsStore()
  const { coverSrc, retry } = useCoverImage(comic.coverUrl, containerRef, sfwMode)
  const [showAllTags, setShowAllTags] = useState(false)
  const { handleCardClick, handleReaderClick, handleTitleClick } = useCardInteraction({
    comic, batchMode, sfwMode, onToggleSelect, onClick, onOpenDrawer, onOpenReader,
  })

  return (
    <div
      ref={containerRef}
      onClick={handleCardClick}
      className={`flex items-center px-4 py-2.5 cursor-pointer transition-colors duration-150
                  border-b border-[var(--border)] hover:bg-[var(--bg-secondary)]
                  ${selected ? 'border-l-2 border-l-[var(--accent)] bg-[var(--accent)]/5' : ''}
                  ${isRecommended && !selected ? 'border-l-2 border-l-amber-400/70' : ''}`}
    >
      {batchMode && (
        <div className={`mr-2 w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0
                        ${selected ? 'bg-[var(--accent)] border-[var(--accent)]' : 'border-[var(--text-secondary)]'}`}>
          {selected && (
            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
      )}
      <div className="flex-shrink-0 rounded-md cursor-pointer" onClick={(e) => { e.stopPropagation(); handleReaderClick() }}>
        <CoverImage
          coverUrl={comic.coverUrl} coverSrc={coverSrc} sfwMode={sfwMode}
          title={comic.title} retry={retry} downloadStatus={downloadStatus}
          variant="detailed" onClick={(e) => { e.stopPropagation(); handleReaderClick() }}
        />
      </div>
      <div className="flex-1 min-w-0 ml-3">
        <h3
          onClick={(e) => {
            e.stopPropagation()
            handleTitleClick()
          }}
          className="text-sm font-medium text-[var(--text-primary)] cursor-pointer select-text truncate"
          title={comic.title}
        >
          {comic.title}
        </h3>
        <div className="text-xs text-[var(--text-secondary)] mt-0.5">
          {comic.author && <span>{comic.author}</span>}
          {comic.author && comic.pages != null && comic.pages > 0 && <span className="mx-1.5">·</span>}
          {comic.pages != null && comic.pages > 0 && <span>{comic.pages} 页</span>}
        </div>
        {comic.tags && comic.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {(showAllTags ? comic.tags : comic.tags.slice(0, 3)).map((tag, i) => {
              const isRecTag = recommendedTags && recommendedTags.has(tag.toLowerCase())
              return (
                <span
                  key={i}
                  className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    isRecTag
                      ? 'bg-amber-500/15 text-amber-600'
                      : 'bg-[var(--accent)]/10 text-[var(--accent)]'
                  }`}
                >
                  {tag}
                </span>
              )
            })}
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
      {!batchMode && onDownload && (
        <button
          onClick={(e) => { e.stopPropagation(); onDownload(comic) }}
          className="flex-shrink-0 ml-2 w-7 h-7 rounded-full bg-[var(--bg-secondary)] text-[var(--text-secondary)]
                     flex items-center justify-center hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
      )}
    </div>
  )
}
