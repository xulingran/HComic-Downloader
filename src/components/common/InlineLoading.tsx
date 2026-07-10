/**
 * 内联居中加载态：spinner 环 + 可选辅助文案。
 *
 * 用于无旧结果可遮罩的加载场景（列表页首次加载、Suspense fallback 等）。
 * 与全视口遮罩组件 {@link LoadingOverlay} 区分：后者是 `fixed inset-0` 翻页/整页替换遮罩，
 * 本组件是容器内 `py-12` 纵向留白的内联块。
 *
 * spinner 复用与 LoadingOverlay / PageSkeleton 一致的 `border-t-accent` 模式 +
 * `motion-safe:animate-spin`，reduced-motion 用户看到静止环。
 * 详见 openspec/changes/inline-loading-state-component/design.md。
 */
interface InlineLoadingProps {
  /** 辅助文案，默认「加载中...」。传空字符串则不渲染文案节点。 */
  text?: string
  /** 合并到外层容器 className（在 `py-12` 之后，可覆盖）。 */
  className?: string
}

export function InlineLoading({ text = '加载中...', className }: InlineLoadingProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-12 ${className ?? ''}`}>
      <div className="w-8 h-8 border-2 border-[var(--text-tertiary)] border-t-[var(--accent)] rounded-full motion-safe:animate-spin" />
      {text && <div className="text-sm text-[var(--text-secondary)]">{text}</div>}
    </div>
  )
}
