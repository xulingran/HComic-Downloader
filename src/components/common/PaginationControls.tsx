interface PaginationControlsProps {
  currentPage: number
  totalPages: number
  onNavigate: (page: number) => void
  onJumpClick: () => void
}

export function PaginationControls({ currentPage, totalPages, onNavigate, onJumpClick }: PaginationControlsProps) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => onNavigate(currentPage - 1)}
        disabled={currentPage <= 1}
        className="px-2 py-0.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border)]
                   disabled:opacity-50"
      >
        上一页
      </button>
      <span
        onClick={onJumpClick}
        className="px-2 py-0.5 text-xs text-[var(--accent)] cursor-pointer hover:underline"
        title="点击跳转到指定页"
      >
        {currentPage} / {totalPages}
      </span>
      <button
        onClick={() => onNavigate(currentPage + 1)}
        disabled={currentPage >= totalPages}
        className="px-2 py-0.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border)]
                   disabled:opacity-50"
      >
        下一页
      </button>
    </div>
  )
}
