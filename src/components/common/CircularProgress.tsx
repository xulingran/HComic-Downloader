import type { DownloadStatus } from '@shared/types'

interface CircularProgressProps {
  progress: number
  size?: number
  strokeWidth?: number
  status?: DownloadStatus
  showText?: boolean
  className?: string
}

function getColor(status: DownloadStatus): string {
  if (status === 'failed') return '#ef4444'
  if (status === 'completed') return '#22c55e'
  return 'var(--accent)'
}

export function CircularProgress({
  progress,
  size = 32,
  strokeWidth = 3,
  status = 'downloading',
  showText = true,
  className,
}: CircularProgressProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - progress / 100)
  const color = getColor(status)
  const isQueued = status === 'queued' && progress === 0

  return (
    <svg
      width={size}
      height={size}
      className={`${isQueued ? 'animate-spin' : ''} ${className ?? ''}`}
      style={isQueued ? { animationDuration: '3s' } : undefined}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.2)"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="transition-[stroke-dashoffset] duration-300"
      />
      {showText && size >= 28 && (
        <text
          x={size / 2}
          y={size / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill="white"
          fontSize={size * 0.26}
          fontWeight="600"
        >
          {Math.round(progress)}
        </text>
      )}
    </svg>
  )
}
