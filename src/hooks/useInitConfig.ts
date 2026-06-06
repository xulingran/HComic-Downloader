import { useEffect, useRef } from 'react'
import { COMIC_SOURCES, type TagBlacklist } from '@shared/types'
import { useSettingsStore, subscribeToBlacklistChanges, subscribeToFavouriteTagHighlightChanges } from '../stores/useSettingsStore'
import { useConfig } from './useIpc'

export function useInitConfig() {
  const {
    setThemeMode, setSfwMode, setTagBlacklist, setFavouriteTagHighlight,
  } = useSettingsStore()
  const { getConfig, setConfig } = useConfig()
  const subscribedRef = useRef(false)
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    getConfig().then((result) => {
      const mode = result?.config?.themeMode
      if (mode === 'light' || mode === 'dark' || mode === 'auto') {
        setThemeMode(mode)
      }

      setSfwMode(true)
      setConfig('sfwMode', true).catch(() => {})

      const rawBlacklist = result.config?.tagBlacklist
      if (rawBlacklist && typeof rawBlacklist === 'object') {
        const raw = rawBlacklist as Record<string, unknown>
        const normalized: TagBlacklist = Object.fromEntries(
          COMIC_SOURCES.map(s => [s, Array.isArray(raw[s]) ? raw[s] as string[] : []])
        ) as TagBlacklist
        setTagBlacklist(normalized)
      }

      if (typeof result.config?.favouriteTagHighlight === 'boolean') {
        setFavouriteTagHighlight(result.config.favouriteTagHighlight)
      }

      if (!subscribedRef.current) {
        subscribedRef.current = true
        const unsubBlacklist = subscribeToBlacklistChanges(setConfig)
        const unsubHighlight = subscribeToFavouriteTagHighlightChanges(setConfig)
        unsubRef.current = () => {
          unsubBlacklist()
          unsubHighlight()
        }
      }
    }).catch(() => {
      setSfwMode(true)
    })

    return () => {
      unsubRef.current?.()
      unsubRef.current = null
      subscribedRef.current = false
    }
  }, [setThemeMode, setSfwMode, setConfig, getConfig, setTagBlacklist, setFavouriteTagHighlight])

  return { setSfwMode, setConfig }
}
