import { useCallback, useState, useEffect } from 'react'
import { useIpc } from './useIpc'
import type {
  MigrationProgressEvent,
  MigrationCompleteEvent,
  MigrationErrorEvent,
  MigrationStatusResponse,
} from '@shared/types'

export function useMigration() {
  const { invoke } = useIpc()

  const [progress, setProgress] = useState<MigrationProgressEvent | null>(null)
  const [complete, setComplete] = useState<MigrationCompleteEvent | null>(null)
  const [errors, setErrors] = useState<MigrationErrorEvent[]>([])
  const [isActive, setIsActive] = useState(false)

  useEffect(() => {
    if (!window.hcomic?.onMigrationProgress) return
    const unsub1 = window.hcomic.onMigrationProgress((data: MigrationProgressEvent) => {
      setProgress(data)
      setIsActive(true)
    })
    const unsub2 = window.hcomic.onMigrationComplete((data: MigrationCompleteEvent) => {
      setComplete(data)
      setIsActive(false)
    })
    const unsub3 = window.hcomic.onMigrationError((data: MigrationErrorEvent) => {
      setErrors(prev => [...prev, data])
    })
    return () => { unsub1(); unsub2(); unsub3() }
  }, [])

  const resetState = useCallback(() => {
    setProgress(null)
    setComplete(null)
    setErrors([])
    setIsActive(false)
  }, [])

  const startMigration = useCallback(async (targetDir: string, mode: 'full' | 'repair') => {
    resetState()
    return invoke(() => window.hcomic!.startMigration(targetDir, mode))
  }, [invoke, resetState])

  const confirmMigration = useCallback(async (migrationId: string) => {
    setIsActive(true)
    setErrors([])
    setProgress(null)
    setComplete(null)
    return invoke(() => window.hcomic!.confirmMigration(migrationId))
  }, [invoke])

  const pauseMigration = useCallback(async () => {
    return invoke(() => window.hcomic!.pauseMigration())
  }, [invoke])

  const resumeMigration = useCallback(async () => {
    setIsActive(true)
    return invoke(() => window.hcomic!.resumeMigration())
  }, [invoke])

  const cancelMigration = useCallback(async () => {
    return invoke(() => window.hcomic!.cancelMigration())
  }, [invoke])

  const getMigrationStatus = useCallback(async () => {
    return invoke(() => window.hcomic!.getMigrationStatus())
  }, [invoke])

  const syncFromBackend = useCallback(async () => {
    try {
      const status: MigrationStatusResponse = await invoke(() => window.hcomic!.getMigrationStatus())
      if (status.status === 'none') {
        resetState()
        return status
      }
      if (status.status === 'running' || status.status === 'paused') {
        setIsActive(true)
        setComplete(null)
        setProgress({
          completed: status.completed_items,
          total: status.total_items,
          currentFile: '',
          speed: 0,
          phase: 'moving',
        })
      } else if (status.status === 'completed') {
        setComplete({
          total: status.total_items,
          succeeded: status.completed_items,
          failed: status.failed_items.length,
          elapsed: 0,
        })
        setIsActive(false)
        setProgress(null)
      } else {
        resetState()
      }
      return status
    } catch {
      // IPC call failed, keep default empty state
      return null
    }
  }, [invoke, resetState])

  const resolveUnmatched = useCallback(async (
    matches: Array<{ dbKey: string[]; file_path: string }>,
  ) => {
    return invoke(() => window.hcomic!.resolveUnmatched(matches))
  }, [invoke])

  return {
    startMigration,
    confirmMigration,
    pauseMigration,
    resumeMigration,
    cancelMigration,
    getMigrationStatus,
    resolveUnmatched,
    syncFromBackend,
    progress,
    complete,
    errors,
    isActive,
    resetState,
  }
}
