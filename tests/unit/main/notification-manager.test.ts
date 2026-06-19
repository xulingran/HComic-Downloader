// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockNotification } = vi.hoisted(() => {
  const mockNotify = vi.fn().mockImplementation(function (this: unknown, _opts: unknown) {
    return { on: vi.fn(), show: vi.fn() }
  })
  mockNotify.isSupported = vi.fn().mockReturnValue(true)
  return { mockNotification: mockNotify }
})

vi.mock('electron', () => ({
  app: { getName: vi.fn().mockReturnValue('TestApp') },
  Notification: mockNotification,
  BrowserWindow: vi.fn(),
}))

import { NotificationManager } from '../../../electron/notification-manager'

describe('NotificationManager', () => {
  let manager: NotificationManager
  let mockMainWindow: { isFocused: ReturnType<typeof vi.fn>; isMinimized: ReturnType<typeof vi.fn>; restore: ReturnType<typeof vi.fn>; show: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.clearAllMocks()
    mockNotification.mockImplementation(function (this: unknown, _opts: unknown) {
      return { on: vi.fn(), show: vi.fn() }
    })
    mockNotification.isSupported.mockReturnValue(true)
    manager = new NotificationManager()
    mockMainWindow = {
      isFocused: vi.fn().mockReturnValue(false),
      isMinimized: vi.fn().mockReturnValue(false),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    }
    manager.setMainWindow(mockMainWindow as unknown as Parameters<typeof manager.setMainWindow>[0])
    manager.updateSettings(true, 'inactive')
  })

  describe('handleProgress — task tracking', () => {
    it('tracks active tasks', () => {
      manager.handleProgress({ taskId: 't1', status: 'downloading', title: 'A' })
      manager.handleProgress({ taskId: 't2', status: 'queued', title: 'B' })
      expect(mockNotification).not.toHaveBeenCalled()
    })

    it('removes tasks when they complete or fail', () => {
      manager.handleProgress({ taskId: 't1', status: 'downloading', title: 'A' })
      manager.handleProgress({ taskId: 't1', status: 'completed', title: 'A' })
      expect(mockNotification).toHaveBeenCalledTimes(1)
    })

    it('tracks paused and pausing as active', () => {
      manager.handleProgress({ taskId: 't1', status: 'paused', title: 'A' })
      manager.handleProgress({ taskId: 't2', status: 'pausing', title: 'B' })
      expect(mockNotification).not.toHaveBeenCalled()
    })

    // 显式覆盖 4 个活跃状态：queued/downloading/pausing/paused 都应保持任务在
    // active 集合内（不触发批量通知）；任一被错误地从 ACTIVE_STATUSES 漏掉都会
    // 让该任务被视为已完成并过早触发通知。
    it('keeps all four active statuses without notifying', () => {
      for (const status of ['queued', 'downloading', 'pausing', 'paused'] as const) {
        manager.handleProgress({ taskId: `task-${status}`, status, title: status })
      }
      // 4 个活跃任务都未离开 active 集合 → 不应有完成通知
      expect(mockNotification).not.toHaveBeenCalled()
    })

    it('only notifies when ALL active tasks have left the active set', () => {
      // 注册 4 个不同活跃状态的任务
      for (const status of ['queued', 'downloading', 'pausing', 'paused'] as const) {
        manager.handleProgress({ taskId: `task-${status}`, status, title: status })
      }
      // 让其中 3 个完成：仍有 1 个 active，不应通知
      manager.handleProgress({ taskId: 'task-queued', status: 'completed', title: 'q' })
      manager.handleProgress({ taskId: 'task-downloading', status: 'completed', title: 'd' })
      manager.handleProgress({ taskId: 'task-pausing', status: 'completed', title: 'p' })
      expect(mockNotification).not.toHaveBeenCalled()
      // 最后一个 active 任务完成 → 触发批量通知
      manager.handleProgress({ taskId: 'task-paused', status: 'completed', title: 'pd' })
      expect(mockNotification).toHaveBeenCalledTimes(1)
    })
  })

  describe('batch notification trigger', () => {
    it('sends notification when all active tasks complete', () => {
      manager.handleProgress({ taskId: 't1', status: 'downloading', title: 'A' })
      manager.handleProgress({ taskId: 't1', status: 'completed', title: 'A' })
      expect(mockNotification).toHaveBeenCalledTimes(1)
      expect(mockNotification).toHaveBeenCalledWith({
        title: 'TestApp',
        body: '下载完成：A',
      })
    })

    it('waits until all active tasks are done', () => {
      manager.handleProgress({ taskId: 't1', status: 'downloading', title: 'A' })
      manager.handleProgress({ taskId: 't2', status: 'completed', title: 'B' })
      expect(mockNotification).not.toHaveBeenCalled()

      manager.handleProgress({ taskId: 't1', status: 'completed', title: 'A' })
      expect(mockNotification).toHaveBeenCalledTimes(1)
    })

    it('batches multiple completions into one notification', () => {
      manager.handleProgress({ taskId: 't1', status: 'downloading', title: 'A' })
      manager.handleProgress({ taskId: 't2', status: 'downloading', title: 'B' })
      manager.handleProgress({ taskId: 't1', status: 'completed', title: 'A' })
      manager.handleProgress({ taskId: 't2', status: 'completed', title: 'B' })
      expect(mockNotification).toHaveBeenCalledTimes(1)
      expect(mockNotification).toHaveBeenCalledWith({
        title: 'TestApp',
        body: '批量下载完成：成功 2 本',
      })
    })

    it('includes failed tasks in batch body', () => {
      manager.handleProgress({ taskId: 't1', status: 'downloading', title: 'A' })
      manager.handleProgress({ taskId: 't2', status: 'downloading', title: 'B' })
      manager.handleProgress({ taskId: 't1', status: 'completed', title: 'A' })
      manager.handleProgress({ taskId: 't2', status: 'failed', title: 'B' })
      expect(mockNotification).toHaveBeenCalledWith({
        title: 'TestApp',
        body: '批量下载完成：成功 1 本，失败 1 本',
      })
    })
  })

  describe('notifyOnComplete = false', () => {
    it('does not send any notification', () => {
      manager.updateSettings(false, 'inactive')
      manager.handleProgress({ taskId: 't1', status: 'completed', title: 'A' })
      expect(mockNotification).not.toHaveBeenCalled()
    })
  })

  describe('notifyWhenForeground = inactive', () => {
    it('suppresses notification when window is focused', () => {
      mockMainWindow.isFocused.mockReturnValue(true)
      manager.handleProgress({ taskId: 't1', status: 'completed', title: 'A' })
      expect(mockNotification).not.toHaveBeenCalled()
    })

    it('sends notification when window is not focused', () => {
      mockMainWindow.isFocused.mockReturnValue(false)
      manager.handleProgress({ taskId: 't1', status: 'completed', title: 'A' })
      expect(mockNotification).toHaveBeenCalledTimes(1)
    })
  })

  describe('notifyWhenForeground = always', () => {
    it('sends notification even when window is focused', () => {
      manager.updateSettings(true, 'always')
      mockMainWindow.isFocused.mockReturnValue(true)
      manager.handleProgress({ taskId: 't1', status: 'completed', title: 'A' })
      expect(mockNotification).toHaveBeenCalledTimes(1)
    })
  })

  describe('Notification.isSupported = false', () => {
    it('does not send notification', () => {
      mockNotification.isSupported.mockReturnValue(false)
      manager.handleProgress({ taskId: 't1', status: 'completed', title: 'A' })
      expect(mockNotification).not.toHaveBeenCalled()
    })
  })

  describe('getter properties', () => {
    it('exposes current notifyOnComplete value', () => {
      expect(manager.notifyOnCompleteValue).toBe(true)
      manager.updateSettings(false, 'inactive')
      expect(manager.notifyOnCompleteValue).toBe(false)
    })

    it('exposes current notifyWhenForeground value', () => {
      expect(manager.notifyWhenForegroundValue).toBe('inactive')
      manager.updateSettings(true, 'always')
      expect(manager.notifyWhenForegroundValue).toBe('always')
    })
  })
})
