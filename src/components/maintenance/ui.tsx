import { motion } from 'framer-motion'

export function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl p-4 ${className}`}>
      {children}
    </div>
  )
}

export function Button({
  onClick,
  children,
  disabled = false,
  variant = 'primary',
  className = '',
  type = 'button',
}: {
  onClick?: () => void
  children: React.ReactNode
  disabled?: boolean
  variant?: 'primary' | 'danger' | 'secondary'
  className?: string
  type?: 'button' | 'submit'
}) {
  const base = 'px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
  const variants = {
    primary: 'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]',
    danger: 'bg-red-500 text-white hover:bg-red-600',
    secondary: 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]',
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </button>
  )
}

export function ProgressBar({ current, total, label }: { current: number; total: number; label?: string }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-[var(--text-secondary)]">
        <span>{label ?? `${current}/${total}`}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-[var(--accent)]"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.2 }}
        />
      </div>
    </div>
  )
}
