import { useEffect, useRef } from 'react'
import { COMIC_SOURCES, type TagBlacklist, type DuplicateBlacklist, type DuplicateBlacklistEntry } from '@shared/types'
import { useSettingsStore, subscribeToBlacklistChanges, subscribeToDuplicateBlacklistChanges, subscribeToFavouriteTagHighlightChanges, subscribeToFavouriteTagMinMatchesChanges } from '../stores/useSettingsStore'
import { useConfig } from './useIpc'

export function useInitConfig() {
  const {
    setThemeMode, setCardStyle, setSfwMode, setTagBlacklist, setDuplicateBlacklist, setFavouriteTagHighlight, setFavouriteTagMinMatches,
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

      const style = result?.config?.cardStyle
      if (style === 'cover' || style === 'detailed') {
        setCardStyle(style)
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

      const rawDupBlacklist = result.config?.duplicateBlacklist
      if (rawDupBlacklist && typeof rawDupBlacklist === 'object') {
        const raw = rawDupBlacklist as Record<string, unknown>
        const normalized: DuplicateBlacklist = Object.fromEntries(
          COMIC_SOURCES.map(s => {
            const arr = Array.isArray(raw[s]) ? raw[s] as unknown[] : []
            // 兼容旧版纯字符串与新版结构化对象
            const entries: DuplicateBlacklistEntry[] = arr.map(item => {
              if (typeof item === 'string') {
                return { fingerprint: item, memberCount: null }
              }
              const obj = item as Record<string, unknown>
              return {
                fingerprint: typeof obj.fingerprint === 'string' ? obj.fingerprint : '',
                memberCount: typeof obj.memberCount === 'number' ? obj.memberCount : null,
              }
            })
            return [s, entries]
          })
        ) as DuplicateBlacklist
        setDuplicateBlacklist(normalized)
      }

      if (typeof result.config?.favouriteTagHighlight === 'boolean') {
        setFavouriteTagHighlight(result.config.favouriteTagHighlight)
      }

      if (typeof result.config?.favouriteTagMinMatches === 'number' && result.config.favouriteTagMinMatches >= 1) {
        setFavouriteTagMinMatches(result.config.favouriteTagMinMatches)
      }

      if (!subscribedRef.current) {
        subscribedRef.current = true
        const unsubBlacklist = subscribeToBlacklistChanges(setConfig)
        const unsubDupBlacklist = subscribeToDuplicateBlacklistChanges(setConfig)
        const unsubHighlight = subscribeToFavouriteTagHighlightChanges(setConfig)
        const unsubMinMatches = subscribeToFavouriteTagMinMatchesChanges(setConfig)
        unsubRef.current = () => {
          unsubBlacklist()
          unsubDupBlacklist()
          unsubHighlight()
          unsubMinMatches()
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
  }, [setThemeMode, setCardStyle, setSfwMode, setConfig, getConfig, setTagBlacklist, setDuplicateBlacklist, setFavouriteTagHighlight, setFavouriteTagMinMatches])

  return { setSfwMode, setConfig }
}
