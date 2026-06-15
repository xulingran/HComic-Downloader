import { create } from 'zustand'
import { COMIC_SOURCES, type TagBlacklist, type DuplicateBlacklist, type CardStyle } from '@shared/types'
import { normalizeSourceKey } from '../utils/source'

type ThemeMode = 'light' | 'dark' | 'auto'

interface SettingsState {
  themeMode: ThemeMode
  cardStyle: CardStyle
  sfwMode: boolean
  sfwToastDismissed: boolean
  tagBlacklist: TagBlacklist
  duplicateBlacklist: DuplicateBlacklist
  filterEnabled: boolean
  favouriteTagHighlight: boolean
  favouriteTagMinMatches: number
  setThemeMode: (mode: ThemeMode) => void
  setCardStyle: (style: CardStyle) => void
  setSfwMode: (enabled: boolean) => void
  dismissSfwToast: () => void
  addTag: (source: string, tag: string) => void
  removeTag: (source: string, tag: string) => void
  setTagBlacklist: (blacklist: TagBlacklist) => void
  addDuplicateIgnore: (source: string, fingerprint: string, memberCount: number) => void
  removeDuplicateIgnore: (source: string, fingerprint: string) => void
  confirmMemberCount: (source: string, fingerprint: string, memberCount: number) => void
  setDuplicateBlacklist: (blacklist: DuplicateBlacklist) => void
  setFilterEnabled: (enabled: boolean) => void
  setFavouriteTagHighlight: (enabled: boolean) => void
  setFavouriteTagMinMatches: (n: number) => void
}

const DEFAULT_TAG_BLACKLIST: TagBlacklist = Object.fromEntries(
  COMIC_SOURCES.map(s => [s, [] as string[]])
) as TagBlacklist

const DEFAULT_DUPLICATE_BLACKLIST: DuplicateBlacklist = Object.fromEntries(
  COMIC_SOURCES.map(s => [s, []])
) as DuplicateBlacklist

export const useSettingsStore = create<SettingsState>((set) => ({
  themeMode: 'auto',
  cardStyle: 'cover',
  sfwMode: true,
  sfwToastDismissed: false,
  tagBlacklist: { ...DEFAULT_TAG_BLACKLIST },
  duplicateBlacklist: { ...DEFAULT_DUPLICATE_BLACKLIST },
  filterEnabled: true,
  favouriteTagHighlight: false,
  favouriteTagMinMatches: 1,
  setThemeMode: (mode) => set({ themeMode: mode }),
  setCardStyle: (style) => set({ cardStyle: style }),
  setSfwMode: (enabled) => set({ sfwMode: enabled }),
  dismissSfwToast: () => set({ sfwToastDismissed: true }),
  addTag: (source, tag) => {
    const trimmed = tag.trim()
    if (!trimmed) return
    set((state) => {
      const key = normalizeSourceKey(source)
      const list = state.tagBlacklist[key]
      if (list.some(t => t.toLowerCase() === trimmed.toLowerCase())) return state
      return {
        tagBlacklist: {
          ...state.tagBlacklist,
          [key]: [...list, trimmed],
        },
      }
    })
  },
  removeTag: (source, tag) => {
    set((state) => {
      const key = normalizeSourceKey(source)
      const lower = tag.toLowerCase()
      return {
        tagBlacklist: {
          ...state.tagBlacklist,
          [key]: state.tagBlacklist[key].filter(t => t.toLowerCase() !== lower),
        },
      }
    })
  },
  setTagBlacklist: (blacklist) => set({ tagBlacklist: blacklist }),
  addDuplicateIgnore: (source, fingerprint, memberCount) => {
    const fp = fingerprint.trim()
    if (!fp) return
    set((state) => {
      const key = normalizeSourceKey(source)
      const list = state.duplicateBlacklist[key]
      // 已存在则更新 memberCount，否则追加
      const existing = list.find(e => e.fingerprint === fp)
      if (existing) {
        return {
          duplicateBlacklist: {
            ...state.duplicateBlacklist,
            [key]: list.map(e => e.fingerprint === fp ? { ...e, memberCount } : e),
          },
        }
      }
      return {
        duplicateBlacklist: {
          ...state.duplicateBlacklist,
          [key]: [...list, { fingerprint: fp, memberCount }],
        },
      }
    })
  },
  removeDuplicateIgnore: (source, fingerprint) => {
    set((state) => {
      const key = normalizeSourceKey(source)
      return {
        duplicateBlacklist: {
          ...state.duplicateBlacklist,
          [key]: state.duplicateBlacklist[key].filter(e => e.fingerprint !== fingerprint),
        },
      }
    })
  },
  // confirmMemberCount 同时用于：用户手动确认变动、检测时静默填充 null 基线
  confirmMemberCount: (source, fingerprint, memberCount) => {
    set((state) => {
      const key = normalizeSourceKey(source)
      return {
        duplicateBlacklist: {
          ...state.duplicateBlacklist,
          [key]: state.duplicateBlacklist[key].map(e =>
            e.fingerprint === fingerprint ? { ...e, memberCount } : e
          ),
        },
      }
    })
  },
  setDuplicateBlacklist: (blacklist) => set({ duplicateBlacklist: blacklist }),
  setFilterEnabled: (enabled) => set({ filterEnabled: enabled }),
  setFavouriteTagHighlight: (enabled) => set({ favouriteTagHighlight: enabled }),
  setFavouriteTagMinMatches: (n) => set({ favouriteTagMinMatches: n }),
}))

/** Subscribe to tagBlacklist changes and persist via setConfig. */
export function subscribeToBlacklistChanges(setConfig: (key: 'tagBlacklist', value: TagBlacklist) => Promise<unknown>) {
  let prev = useSettingsStore.getState().tagBlacklist
  return useSettingsStore.subscribe((state) => {
    if (state.tagBlacklist !== prev) {
      prev = state.tagBlacklist
      setConfig('tagBlacklist', state.tagBlacklist).catch(() => {})
    }
  })
}

/** Subscribe to duplicateBlacklist changes and persist via setConfig. */
export function subscribeToDuplicateBlacklistChanges(setConfig: (key: 'duplicateBlacklist', value: DuplicateBlacklist) => Promise<unknown>) {
  let prev = useSettingsStore.getState().duplicateBlacklist
  return useSettingsStore.subscribe((state) => {
    if (state.duplicateBlacklist !== prev) {
      prev = state.duplicateBlacklist
      setConfig('duplicateBlacklist', state.duplicateBlacklist).catch(() => {})
    }
  })
}

/** Subscribe to favouriteTagHighlight changes and persist via setConfig. */
export function subscribeToFavouriteTagHighlightChanges(setConfig: (key: 'favouriteTagHighlight', value: boolean) => Promise<unknown>) {
  let prev = useSettingsStore.getState().favouriteTagHighlight
  return useSettingsStore.subscribe((state) => {
    if (state.favouriteTagHighlight !== prev) {
      prev = state.favouriteTagHighlight
      setConfig('favouriteTagHighlight', state.favouriteTagHighlight).catch(() => {})
    }
  })
}

/** Subscribe to favouriteTagMinMatches changes and persist via setConfig. */
export function subscribeToFavouriteTagMinMatchesChanges(setConfig: (key: 'favouriteTagMinMatches', value: number) => Promise<unknown>) {
  let prev = useSettingsStore.getState().favouriteTagMinMatches
  return useSettingsStore.subscribe((state) => {
    if (state.favouriteTagMinMatches !== prev) {
      prev = state.favouriteTagMinMatches
      setConfig('favouriteTagMinMatches', state.favouriteTagMinMatches).catch(() => {})
    }
  })
}
