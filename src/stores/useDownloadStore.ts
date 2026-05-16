import { create } from 'zustand'
import { DownloadTask } from '@shared/types'

interface DownloadState {
  tasks: DownloadTask[]
  isGloballyPaused: boolean
  setTasks: (tasks: DownloadTask[]) => void
  addTask: (task: DownloadTask) => void
  upsertTask: (task: DownloadTask) => void
  updateTask: (id: string, updates: Partial<DownloadTask>) => void
  removeTask: (id: string) => void
  setGlobalPaused: (paused: boolean) => void
}

function insertTaskByStatus(tasks: DownloadTask[], newTask: DownloadTask): DownloadTask[] {
  const isCompleted = (status: string) => status === 'completed' || status === 'cancelled'

  let lastIncompleteIndex = -1
  for (let i = tasks.length - 1; i >= 0; i--) {
    if (!isCompleted(tasks[i].status)) {
      lastIncompleteIndex = i
      break
    }
  }

  const insertAt = lastIncompleteIndex + 1
  const result = [...tasks]
  result.splice(insertAt, 0, newTask)
  return result
}

export const useDownloadStore = create<DownloadState>((set) => ({
  tasks: [],
  isGloballyPaused: false,
  setTasks: (tasks) => set({ tasks }),
  addTask: (task) => set((state) => ({ tasks: insertTaskByStatus(state.tasks, task) })),
  upsertTask: (task) =>
    set((state) => {
      const exists = state.tasks.some((t) => t.id === task.id)
      return exists
        ? { tasks: state.tasks.map((t) => (t.id === task.id ? { ...t, ...task } : t)) }
        : { tasks: insertTaskByStatus(state.tasks, task) }
    }),
  updateTask: (id, updates) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t))
    })),
  removeTask: (id) =>
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id)
    })),
  setGlobalPaused: (paused) => set({ isGloballyPaused: paused }),
}))
