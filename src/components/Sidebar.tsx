interface SidebarProps {
  activePage: string
  onPageChange: (page: string) => void
}

const menuItems = [
  { id: 'search', label: '搜索', icon: '🔍' },
  { id: 'downloads', label: '下载管理', icon: '📥' },
  { id: 'favourites', label: '收藏夹', icon: '⭐' },
  { id: 'statistics', label: '数据统计', icon: '📊' },
  { id: 'settings', label: '设置', icon: '⚙️' }
]

export function Sidebar({ activePage, onPageChange }: SidebarProps) {
  return (
    <div className="w-16 bg-[var(--bg-primary)] border-r border-[var(--border)] flex flex-col items-center py-4 gap-2">
      {menuItems.map((item) => (
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
