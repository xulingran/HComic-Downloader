interface StatCardProps {
  title: string
  value: string | number
  icon: string
  color: string
  subtitle?: string
}

export function StatCard({ title, value, icon, color, subtitle }: StatCardProps) {
  return (
    <div className="bg-[var(--bg-primary)] rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: `${color}20` }}
        >
          <span className="text-xl">{icon}</span>
        </div>
        <span className="text-sm text-[var(--text-secondary)]">{title}</span>
      </div>
      <div className="text-2xl font-bold text-[var(--text-primary)]">
        {value}
      </div>
      {subtitle && (
        <div className="text-xs text-[var(--text-secondary)] mt-1">
          {subtitle}
        </div>
      )}
    </div>
  )
}
