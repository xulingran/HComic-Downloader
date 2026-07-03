/**
 * 漫画预览阅读器内的"加载中"占位组件。
 *
 * 阅读器整体强制深色背景（`ComicReaderModal` 的 `bg-[#1a1a2e]`），本占位用同色填充，
 * 仅靠中心 spinner 传达加载语义——避免浅色主题下 `Skeleton` 走主题变量产生的白色色块。
 * 占位保持 `aspect-ratio: 3/4`，与漫画页比例一致，避免加载完成时高度跳动。
 *
 * 视觉规则见 `openspec/specs/preview-loading-placeholder/spec.md`。
 *
 * reduced-motion：spinner 复用 `animate-spin`，全局 CSS 兜底
 * （`src/styles/index.css` 的 `prefers-reduced-motion` 块）会把
 * `animation-iteration-count` 压成 1 自动停止旋转，无需组件级判断。
 */
interface ReaderPagePlaceholderProps {
  /** 外层尺寸覆盖，如 'h-full w-full'；默认填满父容器宽度 */
  className?: string
}

export function ReaderPagePlaceholder({ className = 'h-full w-full' }: ReaderPagePlaceholderProps) {
  return (
    <div
      className={`flex items-center justify-center ${className}`}
      aria-hidden
      style={{
        aspectRatio: '3 / 4',
        // 与 ComicReaderModal 阅读区背景同色，让占位"融入"阅读器
        background: '#1a1a2e',
        maxWidth: '100%',
      }}
    >
      <svg
        className="animate-spin h-6 w-6 text-gray-400"
        viewBox="0 0 24 24"
        fill="none"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  )
}
