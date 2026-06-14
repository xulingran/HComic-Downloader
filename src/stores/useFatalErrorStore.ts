import { create } from 'zustand'
import type { FatalErrorEvent } from '@shared/types'

interface FatalErrorState {
  /** 当前致命错误，null 表示无致命错误（横幅隐藏） */
  error: FatalErrorEvent | null
  /** 设置致命错误（覆盖旧的，单例） */
  setError: (error: FatalErrorEvent) => void
  /** 清除致命错误（用户关闭横幅或后端恢复） */
  clear: () => void
}

export const useFatalErrorStore = create<FatalErrorState>((set) => ({
  error: null,
  setError: (error) => set({ error }),
  clear: () => set({ error: null }),
}))
