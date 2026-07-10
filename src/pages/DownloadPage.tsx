import { useEffect, useState, useMemo } from 'react'
import { DownloadTasksView } from '../components/library/DownloadTasksView'
import { LibraryCatalogView } from '../components/library/LibraryCatalogView'
import { useDownloadStore } from '../stores/useDownloadStore'
import { ACTIVE_DOWNLOAD_STATUSES } from '@shared/types'

type Subtab = 'library' | 'tasks'

interface DownloadPageProps {
  /** 该页是否为当前激活 tab。keep-alive 下用于切回时轻量刷新任务列表。 */
  isActive?: boolean
}

/**
 * 漫画库工作区容器。
 *
 * 将原"下载管理"页面升级为统一工作区，内部包含"漫画库"和"下载任务"两个子页签。
 * 漫画库为默认子页签。下载进度监听位于工作区层，不受子页签切换影响。
 *
 * 路由/页面 ID 保持 `downloads`，避免破坏页面懒创建、keep-alive 和既有测试。
 */
export function DownloadPage({ isActive = false }: DownloadPageProps = {}) {
  // 会话级子页签状态，默认漫画库
  const [activeSubtab, setActiveSubtab] = useState<Subtab>('library')

  // 下载进度监听位于工作区层，保证用户浏览漫画库时仍持续更新
  const tasks = useDownloadStore((s) => s.tasks)
  const activeCount = useMemo(() => tasks.filter((t) => ACTIVE_DOWNLOAD_STATUSES.has(t.status)).length, [tasks])

  // 子页签切换时不需要特殊初始化——两个子视图各自管理自己的数据加载
  useEffect(() => {
    // isActive 变化时不需要重新加载（子视图通过自己的 isActive prop 处理 keep-alive）
  }, [isActive])

  return (
    <div
      className="min-w-0 px-4 py-4 pb-8 sm:px-6 sm:py-6 sm:pb-10"
      data-testid="download-page-shell"
    >
      <div className="mx-auto w-full max-w-6xl space-y-4" data-testid="download-page-content">
        {/* 子页签 */}
        <div className="flex items-center gap-1 border-b border-[var(--border)]" data-testid="workspace-subtabs">
          <SubtabButton
            active={activeSubtab === 'library'}
            onClick={() => setActiveSubtab('library')}
            testId="subtab-library"
          >
            漫画库
          </SubtabButton>
          <SubtabButton
            active={activeSubtab === 'tasks'}
            onClick={() => setActiveSubtab('tasks')}
            badge={activeCount > 0 ? activeCount : undefined}
            testId="subtab-tasks"
          >
            下载任务
          </SubtabButton>
        </div>

        {/* 子页签内容——两个子视图都保持挂载（保活），用 display 控制可见性 */}
        <div style={{ display: activeSubtab === 'library' ? 'block' : 'none' }}>
          <LibraryCatalogView />
        </div>
        <div style={{ display: activeSubtab === 'tasks' ? 'block' : 'none' }}>
          <DownloadTasksView isActive={isActive && activeSubtab === 'tasks'} />
        </div>
      </div>
    </div>
  )
}

function SubtabButton({
  active,
  onClick,
  children,
  badge,
  testId,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  badge?: number
  testId: string
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={`relative px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? 'border-b-2 border-[var(--accent)] text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
      }`}
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span
          className="ml-1.5 inline-flex items-center justify-center rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-medium text-white"
          style={{ minWidth: '18px', height: '18px' }}
        >
          {badge}
        </span>
      )}
    </button>
  )
}
