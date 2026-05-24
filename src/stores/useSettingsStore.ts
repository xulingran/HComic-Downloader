import { create } from 'zustand'
import type { TagBlacklist, CardStyle } from '@shared/types'

type ThemeMode = 'light' | 'dark' | 'auto'

interface SettingsState {
  themeMode: ThemeMode
  cardStyle: CardStyle
  sfwMode: boolean
  sfwToastDismissed: boolean
  tagBlacklist: TagBlacklist
  filterEnabled: boolean
  setThemeMode: (mode: ThemeMode) => void
  setCardStyle: (style: CardStyle) => void
  setSfwMode: (enabled: boolean) => void
  dismissSfwToast: () => void
  addTag: (source: string, tag: string) => void
  removeTag: (source: string, tag: string) => void
  setTagBlacklist: (blacklist: TagBlacklist) => void
  setFilterEnabled: (enabled: boolean) => void
}

const DEFAULT_TAG_BLACKLIST: TagBlacklist = { hcomic: [], moeimg: [] }

export const useSettingsStore = create<SettingsState>((set) => ({
  themeMode: 'auto',
  cardStyle: 'cover',
  sfwMode: true,
  sfwToastDismissed: false,
  tagBlacklist: { ...DEFAULT_TAG_BLACKLIST },
  filterEnabled: true,
  setThemeMode: (mode) => set({ themeMode: mode }),
  setCardStyle: (style) => set({ cardStyle: style }),
  setSfwMode: (enabled) => set({ sfwMode: enabled }),
  dismissSfwToast: () => set({ sfwToastDismissed: true }),
  addTag: (source, tag) => {
    const trimmed = tag.trim()
    if (!trimmed) return
    set((state) => {
      const key = (source === 'moeimg' ? 'moeimg' : 'hcomic') as keyof TagBlacklist
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
      const key = (source === 'moeimg' ? 'moeimg' : 'hcomic') as keyof TagBlacklist
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
