/**
 * 列表页翻页/整页替换加载时的统一遮罩。
 *
 * 用 fixed inset-0 覆盖整个视口：spinner 永远在视口正中（而非网格容器中心），
 * 遮罩盖住标题栏/侧栏/网格/翻页控件，最强烈地表明"正在加载"。
 *
 * 居中渲染 spinner（不确定性动画，复用 PageSkeleton 的 border-t-accent 模式）
 * + 一行辅助文案（强遮罩下作为语义锚点，避免转动被误判为卡顿）。
 * 背景不透明度与 backdrop-blur 按 intensity 两档：
 *   light  = 翻页（旧结果基本不可辨认）  backdrop-blur-[8px]  bg/80
 *   strong = 整页替换（旧结果几乎完全遮蔽） backdrop-blur-[16px] bg/92
 *
 * spinner 用 motion-safe:animate-spin，reduced-motion 用户看到静止环。
 * 详见 openspec/changes/unify-pagination-loading/design.md。
 */
const OVERLAY_BG: Record<Intensity, string> = {
  light: 'bg-[var(--bg-primary)]/80 backdrop-blur-[8px]',
  strong: 'bg-[var(--bg-primary)]/92 backdrop-blur-[16px]',
}

type Intensity = 'light' | 'strong'

interface LoadingOverlayProps {
  intensity: Intensity
  text?: string
}

export function LoadingOverlay({ intensity, text = '加载中...' }: LoadingOverlayProps) {
  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 ${OVERLAY_BG[intensity]}`}
    >
      <div className="w-8 h-8 border-2 border-[var(--text-tertiary)] border-t-[var(--accent)] rounded-full motion-safe:animate-spin" />
      <span className="text-sm text-[var(--text-secondary)]">{text}</span>
    </div>
  )
}
