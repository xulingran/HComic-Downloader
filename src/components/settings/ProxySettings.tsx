import type { ProxyStatus } from '@shared/types'

interface ProxySettingsProps {
  proxyStatus: ProxyStatus | null
  proxyLoading: boolean
  onRefresh: () => void
}

export function ProxySettings({
  proxyStatus,
  proxyLoading,
  onRefresh,
}: ProxySettingsProps) {
  return (
    <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm space-y-4">
      <h3 className="text-base font-medium text-[var(--text-primary)] border-b border-[var(--border)] pb-3">
        系统代理
      </h3>
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-[var(--text-secondary)] w-16 flex-shrink-0">HTTP:</span>
          <span className="text-[var(--text-primary)]">{proxyStatus?.http || '未检测到'}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-[var(--text-secondary)] w-16 flex-shrink-0">HTTPS:</span>
          <span className="text-[var(--text-primary)]">{proxyStatus?.https || '未检测到'}</span>
        </div>
        <button
          onClick={onRefresh}
          disabled={proxyLoading}
          className="px-3 py-1 text-sm rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]
                     text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
        >
          {proxyLoading ? '检测中...' : '刷新代理'}
        </button>
      </div>
    </div>
  )
}
