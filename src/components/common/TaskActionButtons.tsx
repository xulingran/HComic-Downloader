import type { DownloadTask } from '@shared/types'

interface TaskActionButtonsProps {
  /** 单个下载任务（按其 status 决定渲染哪组按钮） */
  task: DownloadTask
  onPause: (taskId: string) => void
  onResume: (taskId: string) => void
  onCancel: (taskId: string) => void
  onRetry: (taskId: string) => void
}

/**
 * 单任务行内操作按钮组：按 task.status 渲染对应按钮。
 *
 * 抽取自 DownloadPage 的章节展开行，统一各状态的按钮样式与交互，
 * 避免在多个状态分支重复书写 className/onClick。按钮均为小尺寸（章节行内），
 * 与专辑头部的批量控制按钮（"全部暂停/全部恢复/重试失败/全部取消"）语义不同。
 */
export function TaskActionButtons({ task, onPause, onResume, onCancel, onRetry }: TaskActionButtonsProps) {
  const status = task.status

  if (status === 'downloading' || status === 'queued') {
    return (
      <div className="flex gap-1 flex-shrink-0">
        <button
          onClick={() => onPause(task.id)}
          className="px-1.5 py-0.5 rounded bg-[var(--bg-primary)] border border-[var(--border)]
                     text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
          title="暂停"
        >
          ⏸
        </button>
        <button
          onClick={() => onCancel(task.id)}
          className="px-1.5 py-0.5 rounded bg-[var(--bg-primary)] border border-[var(--border)]
                     text-[var(--error)] hover:bg-[var(--bg-tertiary)]"
          title="取消"
        >
          ✕
        </button>
      </div>
    )
  }

  if (status === 'pausing') {
    return <span className="px-1.5 py-0.5 rounded text-[var(--text-secondary)]">暂停中</span>
  }

  if (status === 'paused') {
    return (
      <div className="flex gap-1 flex-shrink-0">
        <button
          onClick={() => onResume(task.id)}
          className="px-1.5 py-0.5 rounded bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
          title="恢复"
        >
          ▶
        </button>
        <button
          onClick={() => onCancel(task.id)}
          className="px-1.5 py-0.5 rounded bg-[var(--bg-primary)] border border-[var(--border)]
                     text-[var(--error)] hover:bg-[var(--bg-tertiary)]"
          title="取消"
        >
          ✕
        </button>
      </div>
    )
  }

  if (status === 'failed') {
    return (
      <div className="flex gap-1 flex-shrink-0">
        <button
          onClick={() => onRetry(task.id)}
          className="px-1.5 py-0.5 rounded bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
          title="重试"
        >
          ↻
        </button>
      </div>
    )
  }

  // completed / cancelled：无操作按钮
  return null
}
