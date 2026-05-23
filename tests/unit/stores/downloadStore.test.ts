import { describe, it, expect, beforeEach } from 'vitest'
import { useDownloadStore } from '@/stores/useDownloadStore'
import type { DownloadTask } from '@shared/types'

const mockTask: DownloadTask = {
  id: 'task-1',
  comic: {
    id: '1',
    title: 'Test Comic',
    url: 'https://example.com/comic/1',
    coverUrl: 'https://example.com/cover.jpg',
    source: 'test'
  },
  status: 'downloading',
  progress: 50,
  totalPages: 10,
  downloadedPages: 5
}

describe('useDownloadStore', () => {
  beforeEach(() => {
    useDownloadStore.setState({ tasks: [] })
  })

  it('应有空的初始任务列表', () => {
    expect(useDownloadStore.getState().tasks).toEqual([])
  })

  it('应能设置所有任务', () => {
    useDownloadStore.getState().setTasks([mockTask])
    expect(useDownloadStore.getState().tasks).toEqual([mockTask])
  })

  it('应能通过 upsertTask 添加新任务', () => {
    useDownloadStore.getState().upsertTask(mockTask)
    expect(useDownloadStore.getState().tasks).toHaveLength(1)
    expect(useDownloadStore.getState().tasks[0].id).toBe('task-1')
  })

  it('upsertTask 应能更新已存在的任务', () => {
    useDownloadStore.getState().upsertTask(mockTask)
    useDownloadStore.getState().upsertTask({ ...mockTask, progress: 80, downloadedPages: 8 })
    const tasks = useDownloadStore.getState().tasks
    expect(tasks).toHaveLength(1)
    expect(tasks[0].progress).toBe(80)
    expect(tasks[0].downloadedPages).toBe(8)
  })

  it('应能更新指定任务', () => {
    useDownloadStore.getState().upsertTask(mockTask)
    useDownloadStore.getState().updateTask('task-1', { progress: 80, downloadedPages: 8 })
    const task = useDownloadStore.getState().tasks[0]
    expect(task.progress).toBe(80)
    expect(task.downloadedPages).toBe(8)
  })

  it('更新不存在的任务应无效果', () => {
    useDownloadStore.getState().upsertTask(mockTask)
    useDownloadStore.getState().updateTask('non-existent', { progress: 100 })
    expect(useDownloadStore.getState().tasks[0].progress).toBe(50)
  })

  it('应能移除任务', () => {
    useDownloadStore.getState().upsertTask(mockTask)
    useDownloadStore.getState().removeTask('task-1')
    expect(useDownloadStore.getState().tasks).toHaveLength(0)
  })

  it('移除不存在的任务应无效果', () => {
    useDownloadStore.getState().upsertTask(mockTask)
    useDownloadStore.getState().removeTask('non-existent')
    expect(useDownloadStore.getState().tasks).toHaveLength(1)
  })

  it('应能更新任务状态为 completed', () => {
    useDownloadStore.getState().upsertTask(mockTask)
    useDownloadStore.getState().updateTask('task-1', { status: 'completed', progress: 100 })
    expect(useDownloadStore.getState().tasks[0].status).toBe('completed')
  })

  it('应能更新任务状态为 failed', () => {
    useDownloadStore.getState().upsertTask(mockTask)
    useDownloadStore.getState().updateTask('task-1', { status: 'failed', error: 'Network timeout' })
    const task = useDownloadStore.getState().tasks[0]
    expect(task.status).toBe('failed')
    expect(task.error).toBe('Network timeout')
  })
})
