interface ErrorDisplayProps {
  message: string | null
}

export function ErrorDisplay({ message }: ErrorDisplayProps) {
  if (!message) return null
  return (
    <div className="p-4 bg-[var(--error)]/10 text-[var(--error)] rounded-lg">
      {message}
    </div>
  )
}
