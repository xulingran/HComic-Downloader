import { Modal } from './Modal'
import { SOURCES_WITH_FAVOURITES, SOURCE_LABELS } from '@shared/types'

interface SourcePickerModalProps {
  /** 控制弹窗显隐 */
  isOpen: boolean
  /** 用户选择某个来源时触发 */
  onSelect: (source: string) => void
  /** 用户通过 ESC/遮罩关闭时触发（视为跳过） */
  onClose: () => void
}

/**
 * 收藏夹来源选择器。
 *
 * 用于应用启动后用户首次进入收藏夹 tab 时的来源引导选择。仅列出
 * SOURCES_WITH_FAVOURITES（支持收藏的来源），排除 copymanga。
 *
 * 视觉参照 SettingsPage 默认来源选项组：来源卡片按钮，选中态 accent 色。
 * 复用 Modal 外壳（方案 A 安全遮罩点击关闭 + reduced-motion 适配）。
 */
export function SourcePickerModal({ isOpen, onSelect, onClose }: SourcePickerModalProps) {
  const sources = SOURCES_WITH_FAVOURITES.map(s => ({ value: s, label: SOURCE_LABELS[s] }))
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="选择收藏夹来源"
      contentClassName="bg-[var(--bg-primary)] rounded-xl p-6 shadow-lg max-w-md w-full"
    >
      <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">选择收藏夹来源</h3>
      <p className="text-sm text-[var(--text-secondary)] mb-4">
        请选择要查看的收藏夹来源，之后可在左侧来源栏随时切换
      </p>
      <div className="flex flex-col gap-2">
        {sources.map((s) => (
          <button
            key={s.value}
            onClick={() => onSelect(s.value)}
            className="px-4 py-3 rounded-lg text-sm transition-colors bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--border)] text-left"
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="flex justify-end mt-4">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] text-sm"
        >
          稍后再说
        </button>
      </div>
    </Modal>
  )
}
