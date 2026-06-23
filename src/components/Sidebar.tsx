interface SidebarProps {
  activePage: string
  onPageChange: (page: string) => void
}

const menuItems = [
  { id: 'search', label: '搜索', icon: '🔍' },
  { id: 'downloads', label: '下载管理', icon: '📥' },
  { id: 'favourites', label: '收藏夹', icon: '⭐' },
  { id: 'history', label: '历史记录', icon: '🕐' },
  { id: 'toolbox', label: '工具箱', icon: '🧰' },
  { id: 'maintenance', label: '维护', icon: '🧹' },
  { id: 'settings', label: '设置', icon: '⚙️' },
  { id: 'about', label: '关于', icon: 'ℹ️' }
]

export function Sidebar({ activePage, onPageChange }: SidebarProps) {
  return (
    <div className="w-16 bg-[var(--bg-primary)] border-r border-[var(--border)] flex flex-col items-center py-4 gap-2">
      {menuItems.map((item) => (
        // transition-all 保留：active 态切换同时改变背景色、阴影、文字色，
        // 拆分为 transition-colors + transition-shadow 会失去原子性，
        // 且 --tw-ring-color 等多个 token 难以精确列出。性能影响可忽略（仅 hover 触发）。
        <button
          key={item.id}
          onClick={() => onPageChange(item.id)}
          className={`
            w-10 h-10 rounded-lg flex items-center justify-center text-lg
            transition-all duration-200
            ${activePage === item.id
              ? 'bg-[var(--accent)] text-white shadow-md'
              : 'hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
            }
          `}
          title={item.label}
        >
          {item.icon}
        </button>
      ))}
    </div>
  )
}
