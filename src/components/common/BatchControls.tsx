interface BatchControlsProps {
  batchMode: boolean
  selectedCount: number
  onToggleBatchMode: (enabled: boolean) => void
  onSelectAll: () => void
  onClearSelection: () => void
  onBatchDownload: () => void
}

export function BatchControls({ batchMode, selectedCount, onToggleBatchMode, onSelectAll, onClearSelection, onBatchDownload }: BatchControlsProps) {
  return (
    <>
      <span className="text-[var(--border)]">|</span>
      <label className="flex items-center gap-1.5 text-xs text-[var(--text-primary)] cursor-pointer">
        <input
          type="checkbox"
          checked={batchMode}
          onChange={(e) => {
            onToggleBatchMode(e.target.checked)
            if (!e.target.checked) onClearSelection()
          }}
          className="rounded"
        />
        批量选择
      </label>
      {batchMode && (
        <>
          <button onClick={onSelectAll} className="px-2 py-0.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border)] hover:bg-[var(--bg-tertiary)]">
            全选
          </button>
          <button onClick={onClearSelection} className="px-2 py-0.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border)] hover:bg-[var(--bg-tertiary)]">
            取消
          </button>
          <button
            onClick={onBatchDownload}
            disabled={selectedCount === 0}
            className="px-2 py-0.5 text-xs rounded bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            批量下载({selectedCount})
          </button>
        </>
      )}
    </>
  )
}
