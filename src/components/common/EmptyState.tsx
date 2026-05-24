interface EmptyStateProps {
  message: string
}

export function EmptyState({ message }: EmptyStateProps) {
  return (
    <div className="text-center text-[var(--text-secondary)] py-12">
      {message}
    </div>
  )
}
