import { create } from 'zustand'

/**
 * 侧边栏收起/展开的会话级状态。
 *
 * 默认收起（isOpen=false），保持变更 add-sidebar-collapse 前的 64px 窄栏体感为初始视觉。
 * 不持久化——重启回到默认收起态（详见变更 proposal 的「临时态」决策）。
 * 结构复刻 useDrawerStore，仅承载布尔开关与对应的 open/close/toggle 动作。
 */
interface SidebarState {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}

export const useSidebarStore = create<SidebarState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
}))
