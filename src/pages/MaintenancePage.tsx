import { useState } from 'react'
import { HealthCheckPanel } from '@/components/maintenance/HealthCheckPanel'
import { OrphanCleanupPanel } from '@/components/maintenance/OrphanCleanupPanel'
import { StorageStatsPanel } from '@/components/maintenance/StorageStatsPanel'

const TABS = [
  { id: 'health', label: '健康检查', icon: '💓' },
  { id: 'orphan', label: '临时目录清理', icon: '🗑️' },
  { id: 'storage', label: '存储分析', icon: '📊' },
] as const

type TabId = typeof TABS[number]['id']

export function MaintenancePage() {
  const [activeTab, setActiveTab] = useState<TabId>('health')

  return (
    <div className="flex gap-0 max-w-5xl h-full">
      <div className="w-[150px] shrink-0">
        <nav className="sticky top-6 space-y-0.5 pr-3" role="tablist" aria-label="维护中心">
          <div className="px-3 py-2 text-xs font-semibold text-[var(--text-secondary)] tracking-wide">
            维护中心
          </div>
          {TABS.map(tab => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`maintenance-panel-${tab.id}`}
              id={`maintenance-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors
                ${activeTab === tab.id
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
                }`}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div
        className="flex-1 min-w-0 space-y-6 overflow-auto pb-8"
        role="tabpanel"
        aria-labelledby={`maintenance-tab-${activeTab}`}
        id={`maintenance-panel-${activeTab}`}
      >
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          {TABS.find(t => t.id === activeTab)?.label}
        </h2>
        {activeTab === 'health' && <HealthCheckPanel />}
        {activeTab === 'orphan' && <OrphanCleanupPanel />}
        {activeTab === 'storage' && <StorageStatsPanel />}
      </div>
    </div>
  )
}
