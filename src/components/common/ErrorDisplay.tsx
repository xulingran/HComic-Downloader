interface ErrorDisplayProps {
  message: string | null
  onRetry?: () => void
}

const IPC_PREFIX_RE = /^Error invoking remote method '[^']+': Error:\s*/

function cleanErrorMessage(raw: string): string {
  return raw.replace(IPC_PREFIX_RE, '')
}

export function ErrorDisplay({ message, onRetry }: ErrorDisplayProps) {
  if (!message) return null
  const cleaned = cleanErrorMessage(message)
  return (
    <div className="mx-4 my-3 flex items-start gap-3 px-4 py-3 rounded-lg border border-[var(--error)]/20 bg-[var(--error)]/5">
      <svg className="w-5 h-5 mt-0.5 shrink-0 text-[var(--error)]" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[var(--error)] leading-relaxed break-all">{cleaned}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="shrink-0 text-xs px-2.5 py-1 rounded border border-[var(--error)]/30 text-[var(--error)] hover:bg-[var(--error)]/10 transition-colors"
        >
          重试
        </button>
      )}
    </div>
  )
}
