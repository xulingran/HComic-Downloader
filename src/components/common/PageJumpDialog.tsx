import { useState } from 'react'

interface PageJumpDialogProps {
  totalPages: number
  onJump: (page: number) => void
  onClose: () => void
}

export function PageJumpDialog({ totalPages, onJump, onClose }: PageJumpDialogProps) {
  const [jumpPage, setJumpPage] = useState('')
  const handleJump = () => {
    const page = parseInt(jumpPage, 10)
    if (page >= 1 && page <= totalPages) {
      onJump(page)
    }
  }
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-lg max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-4">跳转到指定页</h3>
        <input
          type="number"
          value={jumpPage}
          onChange={(e) => setJumpPage(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleJump() }}
          min={1}
          max={totalPages}
          placeholder={`1 - ${totalPages}`}
          className="w-full px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                     text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)]"
          >
            取消
          </button>
          <button
            onClick={handleJump}
            className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white"
          >
            跳转
          </button>
        </div>
      </div>
    </div>
  )
}
