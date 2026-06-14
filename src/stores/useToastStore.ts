import { create } from 'zustand'

export type ToastType = 'info' | 'error' | 'success'

interface ToastData {
  message: string
  type: ToastType
  visible: boolean
}

interface ToastState {
  toast: ToastData
  /** 显示一条 Toast（覆盖当前）。自动消失由 Toaster 组件负责。 */
  show: (message: string, type?: ToastType) => void
  /** 显示错误 Toast（show 的快捷方式） */
  error: (message: string) => void
  /** 显示信息 Toast */
  info: (message: string) => void
  /** 显示成功 Toast */
  success: (message: string) => void
  /** 隐藏 Toast */
  dismiss: () => void
}

const EMPTY_TOAST: ToastData = { message: '', type: 'info', visible: false }

export const useToastStore = create<ToastState>((set) => ({
  toast: { ...EMPTY_TOAST },
  show: (message, type = 'info') => set({ toast: { message, type, visible: true } }),
  error: (message) => set({ toast: { message, type: 'error', visible: true } }),
  info: (message) => set({ toast: { message, type: 'info', visible: true } }),
  success: (message) => set({ toast: { message, type: 'success', visible: true } }),
  dismiss: () => set((state) => ({ toast: { ...state.toast, visible: false } })),
}))
