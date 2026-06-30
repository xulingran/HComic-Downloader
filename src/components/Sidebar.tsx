import { AnimatePresence, motion } from 'framer-motion'
import { useSidebarStore } from '@/stores/useSidebarStore'
import { DURATION, useReducedMotionPreference } from '@/lib/anim'

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
  const isOpen = useSidebarStore((s) => s.isOpen)
  const toggle = useSidebarStore((s) => s.toggle)
  const reduceMotion = useReducedMotionPreference()

  const labelVariants = {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: DURATION.base } },
    exit: { opacity: 0, transition: { duration: DURATION.base } },
  }

  return (
    <div
      className={`
        ${isOpen ? 'w-52' : 'w-16'} bg-[var(--bg-primary)] border-r border-[var(--border)]
        flex flex-col ${isOpen ? 'items-stretch' : 'items-center'} py-4 gap-2
        transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden
      `}
    >
      {menuItems.map((item) => {
        const isActive = activePage === item.id
        return (
          // transition-all 保留：active 态切换同时改变背景色、阴影、文字色，
          // 拆分为 transition-colors + transition-shadow 会失去原子性，
          // 且 --tw-ring-color 等多个 token 难以精确列出。性能影响可忽略（仅 hover 触发）。
          <button
            key={item.id}
            onClick={() => onPageChange(item.id)}
            className={`
              ${isOpen ? 'w-full flex items-center gap-3 px-3 h-10' : 'w-10 h-10 flex items-center justify-center'}
              rounded-lg text-lg whitespace-nowrap transition-all duration-200
              ${isActive
                ? 'bg-[var(--accent)] text-white shadow-md'
                : 'hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
              }
            `}
            title={isOpen ? undefined : item.label}
          >
            <span className="flex-shrink-0">{item.icon}</span>
            {isOpen && (
              reduceMotion
                ? <span className="text-sm whitespace-nowrap">{item.label}</span>
                : (
                  <AnimatePresence>
                    <motion.span
                      key="label"
                      variants={labelVariants}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      className="text-sm whitespace-nowrap"
                    >
                      {item.label}
                    </motion.span>
                  </AnimatePresence>
                )
            )}
          </button>
        )
      })}

      {/* toggle 按钮：mt-auto 顶到侧边栏最底；图标反映即将执行的动作（收起态指展开、展开态指收起） */}
      <button
        onClick={() => toggle()}
        className={`
          ${isOpen ? 'w-full flex items-center gap-3 px-3 h-10' : 'w-10 h-10 flex items-center justify-center'}
          mt-auto rounded-lg text-lg whitespace-nowrap transition-all duration-200
          hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)]
        `}
        title={isOpen ? '收起侧边栏' : '展开侧边栏'}
        aria-label={isOpen ? '收起侧边栏' : '展开侧边栏'}
      >
        <span className="flex-shrink-0">{isOpen ? '«' : '»'}</span>
        {isOpen && (
          reduceMotion
            ? <span className="text-sm whitespace-nowrap">收起</span>
            : (
              <AnimatePresence>
                <motion.span
                  key="toggle-label"
                  variants={labelVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="text-sm whitespace-nowrap"
                >
                  收起
                </motion.span>
              </AnimatePresence>
            )
        )}
      </button>
    </div>
  )
}
