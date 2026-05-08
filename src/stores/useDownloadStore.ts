import { create } from 'zustand'
import { DownloadTask } from '@shared/types'

interface DownloadState {
  tasks: DownloadTask[]
  setTasks: (tasks: DownloadTask[]) => void
  addTask: (task: DownloadTask) => void
  upsertTask: (task: DownloadTask) => void
  updateTask: (id: string, updates: Partial<DownloadTask>) => void
  removeTask: (id: string) => void
}

export const useDownloadStore = create<DownloadState>((set) => ({
  tasks: [],
  setTasks: (tasks) => set({ tasks }),
  addTask: (task) => set((state) => ({ tasks: [...state.tasks, task] })),
  upsertTask: (task) =>
    set((state) => {
      const exists = state.tasks.some((t) => t.id === task.id)
      return exists
        ? { tasks: state.tasks.map((t) => (t.id === task.id ? { ...t, ...task } : t)) }
        : { tasks: [...state.tasks, task] }
    }),
  updateTask: (id, updates) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t))
    })),
  removeTask: (id) =>
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id)
    }))
}))
