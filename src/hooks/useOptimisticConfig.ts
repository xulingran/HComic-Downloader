import { useCallback } from 'react'
import type { ConfigKey, ConfigValueMap } from '@shared/types'

/**
 * Reusable hook for optimistic config updates in the Settings page.
 * Encapsulates the saveError/setIsSaving/setConfig pattern used by
 * handleThemeChange, handleSfwModeChange, handleOutputFormatChange, etc.
 */
export function useOptimisticConfig(
  setConfig: <K extends ConfigKey>(key: K, value: ConfigValueMap[K]) => Promise<{ success: boolean }>,
  setSaveError: (msg: string | null) => void,
  setIsSaving: (v: boolean) => void,
) {
  const createHandler = useCallback(<K extends ConfigKey>(
    key: K,
    getPrev: () => ConfigValueMap[K],
    setLocal: (value: ConfigValueMap[K]) => void,
    onRevert: (prev: ConfigValueMap[K]) => void,
  ) => {
    return async (value: ConfigValueMap[K]) => {
      const prev = getPrev()
      setSaveError(null)
      setLocal(value)
      setIsSaving(true)
      try {
        await setConfig(key, value)
      } catch (err: any) {
        onRevert(prev)
        setSaveError(err?.message || '保存失败')
        setTimeout(() => setSaveError(null), 5000)
      } finally {
        setIsSaving(false)
      }
    }
  }, [setConfig, setSaveError, setIsSaving])

  return { createHandler }
}
