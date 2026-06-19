import { useReducedMotionPreference } from '../../lib/anim'

interface SkeletonProps {
  /** 形状变体：rect=圆角矩形（封面/卡片）、text=文本条、circle=圆形（头像） */
  variant?: 'rect' | 'text' | 'circle'
  className?: string
  style?: React.CSSProperties
}

/**
 * 通用加载骨架组件。
 *
 * 用 shimmer 动画（变更 1 定义的 keyframe）实现「内容正在填充」的视觉占位，
 * 替代散落各处的 SVG spinner。配色用 --bg-secondary 基底 + --bg-tertiary 高光。
 *
 * reduced-motion 下退化为静态渐变（无移动）。
 *
 * 用法：
 *   <Skeleton variant="rect" className="aspect-[6/7] rounded-xl" />  // 封面
 *   <Skeleton variant="text" className="h-4 w-32" />                 // 文本条
 */
export function Skeleton({ variant = 'rect', className = '', style }: SkeletonProps) {
  const reduceMotion = useReducedMotionPreference()

  const variantClass = variant === 'circle'
    ? 'rounded-full'
    : variant === 'text'
      ? 'rounded'
      : 'rounded-lg'

  // shimmer 高光：linear-gradient + backgroundSize:200% + backgroundPosition 动画。
  // 变更 1 的 shimmer keyframe 是 backgroundPosition: -200% → 200%。
  const shimmerStyle: React.CSSProperties = {
    background: 'linear-gradient(90deg, var(--bg-secondary) 25%, var(--bg-tertiary) 50%, var(--bg-secondary) 75%)',
    backgroundSize: '200% 100%',
    ...style,
  }

  // reduced-motion：关闭 animation，只保留静态渐变。
  if (reduceMotion) {
    return <div className={`${variantClass} ${className}`} style={shimmerStyle} aria-hidden />
  }

  return (
    <div
      className={`${variantClass} animate-shimmer ${className}`}
      style={shimmerStyle}
      aria-hidden
    />
  )
}
