import { useEffect, useRef, useState } from 'react'
import { COMIC_SOURCES, type TagBlacklist, type MyTags, type DuplicateBlacklist, type DuplicateBlacklistEntry, type MissingBlacklist } from '@shared/types'
import { useSettingsStore, subscribeToBlacklistChanges, subscribeToMyTagsChanges, subscribeToDuplicateBlacklistChanges, subscribeToMissingBlacklistChanges, subscribeToFavouriteTagHighlightChanges, subscribeToFavouriteTagMinMatchesChanges, subscribeToDefaultFavouriteSourceChanges } from '../stores/useSettingsStore'
import { useConfig } from './useIpc'

export function useInitConfig() {
  const {
    setThemeMode, setCardStyle, setSfwMode, setTagBlacklist, setMyTags, setDuplicateBlacklist, setMissingBlacklist, setFavouriteTagHighlight, setFavouriteTagMinMatches, setDefaultFavouriteSource,
  } = useSettingsStore()
  const { getConfig, setConfig } = useConfig()
  const subscribedRef = useRef(false)
  const unsubRef = useRef<(() => void) | null>(null)
  // 配置是否加载完成：App 据此判定首屏就绪，触发 StartupScreen 淡出
  const [configLoaded, setConfigLoaded] = useState(false)

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

      const rawMyTags = result.config?.myTags
      if (rawMyTags && typeof rawMyTags === 'object') {
        const raw = rawMyTags as Record<string, unknown>
        const normalized: MyTags = Object.fromEntries(
          COMIC_SOURCES.map(s => [s, Array.isArray(raw[s]) ? raw[s] as string[] : []])
        ) as MyTags
        setMyTags(normalized)
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

      const rawMissingBlacklist = result.config?.missingBlacklist
      if (rawMissingBlacklist && typeof rawMissingBlacklist === 'object') {
        const raw = rawMissingBlacklist as Record<string, unknown>
        const normalized: MissingBlacklist = Object.fromEntries(
          COMIC_SOURCES.map(s => {
            const arr = Array.isArray(raw[s]) ? raw[s] as unknown[] : []
            // 兼容旧版纯字符串与新版结构化对象（与 duplicateBlacklist 同构）
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
        ) as MissingBlacklist
        setMissingBlacklist(normalized)
      }

      if (typeof result.config?.favouriteTagHighlight === 'boolean') {
        setFavouriteTagHighlight(result.config.favouriteTagHighlight)
      }

      if (typeof result.config?.favouriteTagMinMatches === 'number' && result.config.favouriteTagMinMatches >= 1) {
        setFavouriteTagMinMatches(result.config.favouriteTagMinMatches)
      }

      if (typeof result.config?.defaultFavouriteSource === 'string') {
        setDefaultFavouriteSource(result.config.defaultFavouriteSource)
      }

      if (!subscribedRef.current) {
        subscribedRef.current = true
        const unsubBlacklist = subscribeToBlacklistChanges(setConfig)
        const unsubMyTags = subscribeToMyTagsChanges(setConfig)
        const unsubDupBlacklist = subscribeToDuplicateBlacklistChanges(setConfig)
        const unsubMissBlacklist = subscribeToMissingBlacklistChanges(setConfig)
        const unsubHighlight = subscribeToFavouriteTagHighlightChanges(setConfig)
        const unsubMinMatches = subscribeToFavouriteTagMinMatchesChanges(setConfig)
        const unsubDefaultFav = subscribeToDefaultFavouriteSourceChanges(setConfig)
        unsubRef.current = () => {
          unsubBlacklist()
          unsubMyTags()
          unsubDupBlacklist()
          unsubMissBlacklist()
          unsubHighlight()
          unsubMinMatches()
          unsubDefaultFav()
        }
      }
      // 配置加载完成：标记首屏就绪，触发 StartupScreen 淡出
      setConfigLoaded(true)
    }).catch(() => {
      setSfwMode(true)
      // 失败也算就绪：否则 StartupScreen 永不淡出，应用卡死
      setConfigLoaded(true)
    })

    return () => {
      unsubRef.current?.()
      unsubRef.current = null
      subscribedRef.current = false
    }
  }, [setThemeMode, setCardStyle, setSfwMode, setConfig, getConfig, setTagBlacklist, setMyTags, setDuplicateBlacklist, setMissingBlacklist, setFavouriteTagHighlight, setFavouriteTagMinMatches, setDefaultFavouriteSource])

  return { setSfwMode, setConfig, configLoaded }
}
