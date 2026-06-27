/**
 * tab 切换/页面加载时的骨架屏 fallback。
 *
 * 轻量占位组件，无动画副作用（仅 CSS animate-spin / animate-pulse），
 * 供 React.lazy 的 Suspense fallback 与 deferred mount（首次进入页面动画期间）复用。
 */
export function PageSkeleton() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="flex flex-col items-center gap-4">
        <div className="w-8 h-8 border-2 border-[var(--text-tertiary)] border-t-[var(--accent)] rounded-full animate-spin" />
        <div className="w-32 h-3 bg-[var(--bg-tertiary)] rounded animate-pulse" />
      </div>
    </div>
  )
}
