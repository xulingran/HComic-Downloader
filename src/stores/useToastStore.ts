import { create } from 'zustand'

export type ToastType = 'info' | 'error' | 'success'

/** Toast 附加选项：操作按钮与持久化（不自动消失） */
export interface ToastOptions {
  /** 操作按钮文案；提供后渲染按钮，需同时提供 onAction */
  actionLabel?: string
  /** 操作按钮回调 */
  onAction?: () => void
  /** 是否常驻（不启动 4 秒自动消失）。默认 false */
  persistent?: boolean
}

interface ToastData {
  message: string
  type: ToastType
  visible: boolean
  actionLabel?: string
  onAction?: () => void
  persistent?: boolean
}

interface ToastState {
  toast: ToastData
  /** 显示一条 Toast（覆盖当前）。自动消失由 Toaster 组件负责（除非 persistent）。 */
  show: (message: string, type?: ToastType, options?: ToastOptions) => void
  /** 显示错误 Toast（show 的快捷方式） */
  error: (message: string, options?: ToastOptions) => void
  /** 显示信息 Toast */
  info: (message: string, options?: ToastOptions) => void
  /** 显示成功 Toast */
  success: (message: string, options?: ToastOptions) => void
  /** 隐藏 Toast */
  dismiss: () => void
}

const EMPTY_TOAST: ToastData = { message: '', type: 'info', visible: false }

export const useToastStore = create<ToastState>((set) => ({
  toast: { ...EMPTY_TOAST },
  show: (message, type = 'info', options) =>
    set({
      toast: {
        message,
        type,
        visible: true,
        actionLabel: options?.actionLabel,
        onAction: options?.onAction,
        persistent: options?.persistent,
      },
    }),
  error: (message, options) =>
    set({ toast: { message, type: 'error', visible: true, actionLabel: options?.actionLabel, onAction: options?.onAction, persistent: options?.persistent } }),
  info: (message, options) =>
    set({ toast: { message, type: 'info', visible: true, actionLabel: options?.actionLabel, onAction: options?.onAction, persistent: options?.persistent } }),
  success: (message, options) =>
    set({ toast: { message, type: 'success', visible: true, actionLabel: options?.actionLabel, onAction: options?.onAction, persistent: options?.persistent } }),
  dismiss: () => set((state) => ({ toast: { ...state.toast, visible: false } })),
}))
