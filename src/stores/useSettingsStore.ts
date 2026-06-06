import { create } from 'zustand'
import { COMIC_SOURCES, type TagBlacklist, type CardStyle } from '@shared/types'
import { normalizeSourceKey } from '../utils/source'

type ThemeMode = 'light' | 'dark' | 'auto'

interface SettingsState {
  themeMode: ThemeMode
  cardStyle: CardStyle
  sfwMode: boolean
  sfwToastDismissed: boolean
  tagBlacklist: TagBlacklist
  filterEnabled: boolean
  favouriteTagHighlight: boolean
  setThemeMode: (mode: ThemeMode) => void
  setCardStyle: (style: CardStyle) => void
  setSfwMode: (enabled: boolean) => void
  dismissSfwToast: () => void
  addTag: (source: string, tag: string) => void
  removeTag: (source: string, tag: string) => void
  setTagBlacklist: (blacklist: TagBlacklist) => void
  setFilterEnabled: (enabled: boolean) => void
  setFavouriteTagHighlight: (enabled: boolean) => void
}

const DEFAULT_TAG_BLACKLIST: TagBlacklist = Object.fromEntries(
  COMIC_SOURCES.map(s => [s, []])
) as TagBlacklist

export const useSettingsStore = create<SettingsState>((set) => ({
  themeMode: 'auto',
  cardStyle: 'cover',
  sfwMode: true,
  sfwToastDismissed: false,
  tagBlacklist: { ...DEFAULT_TAG_BLACKLIST },
  filterEnabled: true,
  favouriteTagHighlight: false,
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
  setFilterEnabled: (enabled) => set({ filterEnabled: enabled }),
  setFavouriteTagHighlight: (enabled) => set({ favouriteTagHighlight: enabled }),
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
