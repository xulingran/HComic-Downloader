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

  // 注：已移除 `应能设置所有任务`（setTasks 纯 setState 往返，Zustand 保证），
  // 以及末尾两个状态字段更新用例（completed/failed 本质是 updateTask 重复）。
  // 保留 upsert 合并逻辑、updateTask 匹配、remove/no-op 防御逻辑等 store 特有行为。详见 strengthen-test-suite 变更提案。

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
})
