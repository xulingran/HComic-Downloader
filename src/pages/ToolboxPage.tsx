import { DuplicateDetector } from '../components/tools/DuplicateDetector'

export function ToolboxPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-[var(--text-primary)]">
        工具箱
      </h2>

      <div className="space-y-4">
        <DuplicateDetector />
      </div>
    </div>
  )
}
