import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMigration } from '@/hooks/useMigration'
import { createMockHcomic } from '../../__mocks__/ipc'

describe('useMigration', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete (window as unknown as Record<string, unknown>).hcomic
  })

  describe('startMigration', () => {
    it('should reset state before starting migration', async () => {
      createMockHcomic({
        startMigration: vi.fn().mockResolvedValue({
          migrationId: 'test-id',
          totalItems: 5,
          sourceDir: '/old',
          targetDir: '/new',
          isSameDrive: true,
        }),
        confirmMigration: vi.fn().mockResolvedValue({ started: true }),
        getMigrationStatus: vi.fn().mockResolvedValue({ status: 'none' }),
      })

      const { result } = renderHook(() => useMigration())

      await act(async () => {
        await result.current.confirmMigration('prev-id')
      })

      expect(result.current.isActive).toBe(true)

      await act(async () => {
        await result.current.startMigration('/new', 'full')
      })

      expect(result.current.progress).toBeNull()
      expect(result.current.complete).toBeNull()
      expect(result.current.errors).toEqual([])
    })
  })

  describe('syncFromBackend', () => {
    it('returns a ready plan so the dialog can restore its preview', async () => {
      const readyStatus = {
        status: 'ready' as const,
        id: 'ready-id',
        mode: 'repair' as const,
        completed_items: 0,
        total_items: 5,
        failed_items: [],
        source_dir: '',
        target_dir: 'E:/library',
        is_same_drive: false,
      }
      createMockHcomic({
        getMigrationStatus: vi.fn().mockResolvedValue(readyStatus),
      })

      const { result } = renderHook(() => useMigration())
      let syncedStatus: unknown

      await act(async () => {
        syncedStatus = await result.current.syncFromBackend()
      })

      expect(syncedStatus).toEqual(readyStatus)
      expect(result.current.isActive).toBe(false)
      expect(result.current.progress).toBeNull()
      expect(result.current.complete).toBeNull()
    })

    it('should sync running state from backend', async () => {
      createMockHcomic({
        getMigrationStatus: vi.fn().mockResolvedValue({
          status: 'running',
          completed_items: 3,
          total_items: 10,
        }),
      })

      const { result } = renderHook(() => useMigration())

      await act(async () => {
        await result.current.syncFromBackend()
      })

      expect(result.current.isActive).toBe(true)
      expect(result.current.progress).toEqual({
        completed: 3,
        total: 10,
        currentFile: '',
        speed: 0,
        phase: 'moving',
      })
    })

    it('should sync paused state as active progress', async () => {
      createMockHcomic({
        getMigrationStatus: vi.fn().mockResolvedValue({
          status: 'paused',
          completed_items: 4,
          total_items: 10,
        }),
      })

      const { result } = renderHook(() => useMigration())

      await act(async () => {
        await result.current.syncFromBackend()
      })

      expect(result.current.isActive).toBe(true)
      expect(result.current.progress?.completed).toBe(4)
      expect(result.current.progress?.total).toBe(10)
    })

    it('should sync completed state from backend', async () => {
      createMockHcomic({
        getMigrationStatus: vi.fn().mockResolvedValue({
          status: 'completed',
          completed_items: 10,
          total_items: 10,
          failed_items: [],
        }),
      })

      const { result } = renderHook(() => useMigration())

      await act(async () => {
        await result.current.syncFromBackend()
      })

      expect(result.current.isActive).toBe(false)
      expect(result.current.complete).toEqual({
        total: 10,
        succeeded: 10,
        failed: 0,
        elapsed: 0,
      })
    })

    it('should reset state when backend returns none', async () => {
      createMockHcomic({
        getMigrationStatus: vi.fn().mockResolvedValue({ status: 'none' }),
      })

      const { result } = renderHook(() => useMigration())

      await act(async () => {
        await result.current.syncFromBackend()
      })

      expect(result.current.isActive).toBe(false)
      expect(result.current.progress).toBeNull()
      expect(result.current.complete).toBeNull()
    })

    it('should reset active state when backend returns a failed terminal state', async () => {
      const statuses = [
        {
          status: 'running', completed_items: 1, total_items: 2,
        },
        {
          status: 'failed', id: 'failed-id', mode: 'repair', completed_items: 1, total_items: 2,
          failed_items: [{ path: '/target/missing.cbz', error: 'missing' }], source_dir: '',
          target_dir: '/target', is_same_drive: false,
        },
      ]
      createMockHcomic({
        getMigrationStatus: vi.fn().mockImplementation(() => Promise.resolve(statuses.shift())),
      })

      const { result } = renderHook(() => useMigration())

      await act(async () => { await result.current.syncFromBackend() })
      expect(result.current.isActive).toBe(true)
      await act(async () => { await result.current.syncFromBackend() })

      expect(result.current.isActive).toBe(false)
      expect(result.current.progress).toBeNull()
      expect(result.current.complete).toBeNull()
    })

    it('should keep default state on IPC failure', async () => {
      createMockHcomic({
        getMigrationStatus: vi.fn().mockRejectedValue(new Error('IPC error')),
      })

      const { result } = renderHook(() => useMigration())

      await act(async () => {
        await result.current.syncFromBackend()
      })

      expect(result.current.isActive).toBe(false)
      expect(result.current.progress).toBeNull()
    })
  })
})
