import { SOURCES_WITH_FAVOURITES, SOURCE_LABELS } from '@shared/types'

interface FavouriteSourceSidebarProps {
  activeSource: string | null
  onSelect: (source: string) => void
}

/** 收藏夹页内的常驻来源导航；仅负责展示和上报选择。 */
export function FavouriteSourceSidebar({ activeSource, onSelect }: FavouriteSourceSidebarProps) {
  return (
    <aside className="w-[150px] shrink-0 self-start" aria-label="收藏来源">
      <nav className="sticky top-6 space-y-0.5 pr-3">
        <div className="px-3 py-2 text-xs font-semibold tracking-wide text-[var(--text-secondary)]">
          收藏来源
        </div>
        {SOURCES_WITH_FAVOURITES.map((source) => {
          const isActive = activeSource === source
          return (
            <button
              key={source}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onSelect(source)}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2
                focus-visible:ring-offset-[var(--bg-secondary)]
                ${isActive
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
                }`}
            >
              {SOURCE_LABELS[source]}
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
