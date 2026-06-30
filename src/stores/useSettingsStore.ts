import { create } from 'zustand'
import { COMIC_SOURCES, type TagBlacklist, type MyTags, type DuplicateBlacklist, type MissingBlacklist, type CardStyle } from '@shared/types'
import { normalizeSourceKey } from '../utils/source'

type ThemeMode = 'light' | 'dark' | 'auto'

interface SettingsState {
  themeMode: ThemeMode
  cardStyle: CardStyle
  sfwMode: boolean
  sfwToastDismissed: boolean
  tagBlacklist: TagBlacklist
  myTags: MyTags
  duplicateBlacklist: DuplicateBlacklist
  missingBlacklist: MissingBlacklist
  filterEnabled: boolean
  favouriteTagHighlight: boolean
  favouriteTagMinMatches: number
  defaultFavouriteSource: string
  setThemeMode: (mode: ThemeMode) => void
  setCardStyle: (style: CardStyle) => void
  setSfwMode: (enabled: boolean) => void
  dismissSfwToast: () => void
  // 返回 false 表示未写入（空标签/重复/与 my_tags 互斥冲突），调用方可据此提示。
  addTag: (source: string, tag: string) => boolean
  removeTag: (source: string, tag: string) => void
  setTagBlacklist: (blacklist: TagBlacklist) => void
  // 返回 false 表示未写入（空标签/重复/与 tag_blacklist 互斥冲突），调用方可据此提示。
  addMyTag: (source: string, tag: string) => boolean
  removeMyTag: (source: string, tag: string) => void
  setMyTags: (myTags: MyTags) => void
  addDuplicateIgnore: (source: string, fingerprint: string, memberCount: number) => void
  removeDuplicateIgnore: (source: string, fingerprint: string) => void
  confirmMemberCount: (source: string, fingerprint: string, memberCount: number) => void
  setDuplicateBlacklist: (blacklist: DuplicateBlacklist) => void
  addMissingIgnore: (source: string, fingerprint: string, memberCount: number) => void
  removeMissingIgnore: (source: string, fingerprint: string) => void
  confirmMissingMemberCount: (source: string, fingerprint: string, memberCount: number) => void
  setMissingBlacklist: (blacklist: MissingBlacklist) => void
  setFilterEnabled: (enabled: boolean) => void
  setFavouriteTagHighlight: (enabled: boolean) => void
  setFavouriteTagMinMatches: (n: number) => void
  setDefaultFavouriteSource: (source: string) => void
}

const DEFAULT_TAG_BLACKLIST: TagBlacklist = Object.fromEntries(
  COMIC_SOURCES.map(s => [s, [] as string[]])
) as TagBlacklist

const DEFAULT_MY_TAGS: MyTags = Object.fromEntries(
  COMIC_SOURCES.map(s => [s, [] as string[]])
) as MyTags

const DEFAULT_DUPLICATE_BLACKLIST: DuplicateBlacklist = Object.fromEntries(
  COMIC_SOURCES.map(s => [s, []])
) as DuplicateBlacklist

const DEFAULT_MISSING_BLACKLIST: MissingBlacklist = Object.fromEntries(
  COMIC_SOURCES.map(s => [s, []])
) as MissingBlacklist

export const useSettingsStore = create<SettingsState>((set) => ({
  themeMode: 'auto',
  cardStyle: 'cover',
  sfwMode: true,
  sfwToastDismissed: false,
  tagBlacklist: { ...DEFAULT_TAG_BLACKLIST },
  myTags: { ...DEFAULT_MY_TAGS },
  duplicateBlacklist: { ...DEFAULT_DUPLICATE_BLACKLIST },
  missingBlacklist: { ...DEFAULT_MISSING_BLACKLIST },
  filterEnabled: true,
  favouriteTagHighlight: false,
  favouriteTagMinMatches: 1,
  defaultFavouriteSource: '',
  setThemeMode: (mode) => set({ themeMode: mode }),
  setCardStyle: (style) => set({ cardStyle: style }),
  setSfwMode: (enabled) => set({ sfwMode: enabled }),
  dismissSfwToast: () => set({ sfwToastDismissed: true }),
  addTag: (source, tag) => {
    const trimmed = tag.trim()
    if (!trimmed) return false
    const key = normalizeSourceKey(source)
    const state = useSettingsStore.getState()
    const list = state.tagBlacklist[key]
    const lower = trimmed.toLowerCase()
    if (list.some(t => t.toLowerCase() === lower)) return false
    // 互斥校验：禁止与 my_tags 冲突（同一来源下不可既屏蔽又推荐同一标签）
    if (state.myTags[key].some(t => t.toLowerCase() === lower)) return false
    set({
      tagBlacklist: {
        ...state.tagBlacklist,
        [key]: [...list, trimmed],
      },
    })
    return true
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
  addMyTag: (source, tag) => {
    const trimmed = tag.trim()
    if (!trimmed || trimmed.length > 64) return false
    const key = normalizeSourceKey(source)
    const state = useSettingsStore.getState()
    const list = state.myTags[key]
    const lower = trimmed.toLowerCase()
    if (list.some(t => t.toLowerCase() === lower)) return false
    // 互斥校验：禁止与 tag_blacklist 冲突（同一来源下不可既推荐又屏蔽同一标签）
    if (state.tagBlacklist[key].some(t => t.toLowerCase() === lower)) return false
    set({
      myTags: {
        ...state.myTags,
        [key]: [...list, trimmed],
      },
    })
    return true
  },
  removeMyTag: (source, tag) => {
    set((state) => {
      const key = normalizeSourceKey(source)
      const lower = tag.toLowerCase()
      return {
        myTags: {
          ...state.myTags,
          [key]: state.myTags[key].filter(t => t.toLowerCase() !== lower),
        },
      }
    })
  },
  setMyTags: (myTags) => set({ myTags }),
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
  addMissingIgnore: (source, fingerprint, memberCount) => {
    const fp = fingerprint.trim()
    if (!fp) return
    set((state) => {
      const key = normalizeSourceKey(source)
      const list = state.missingBlacklist[key]
      // 已存在则更新 memberCount，否则追加
      const existing = list.find(e => e.fingerprint === fp)
      if (existing) {
        return {
          missingBlacklist: {
            ...state.missingBlacklist,
            [key]: list.map(e => e.fingerprint === fp ? { ...e, memberCount } : e),
          },
        }
      }
      return {
        missingBlacklist: {
          ...state.missingBlacklist,
          [key]: [...list, { fingerprint: fp, memberCount }],
        },
      }
    })
  },
  removeMissingIgnore: (source, fingerprint) => {
    set((state) => {
      const key = normalizeSourceKey(source)
      return {
        missingBlacklist: {
          ...state.missingBlacklist,
          [key]: state.missingBlacklist[key].filter(e => e.fingerprint !== fingerprint),
        },
      }
    })
  },
  // confirmMissingMemberCount 同时用于：用户手动确认变动、检测时静默填充 null 基线
  confirmMissingMemberCount: (source, fingerprint, memberCount) => {
    set((state) => {
      const key = normalizeSourceKey(source)
      return {
        missingBlacklist: {
          ...state.missingBlacklist,
          [key]: state.missingBlacklist[key].map(e =>
            e.fingerprint === fingerprint ? { ...e, memberCount } : e
          ),
        },
      }
    })
  },
  setMissingBlacklist: (blacklist) => set({ missingBlacklist: blacklist }),
  setFilterEnabled: (enabled) => set({ filterEnabled: enabled }),
  setFavouriteTagHighlight: (enabled) => set({ favouriteTagHighlight: enabled }),
  setFavouriteTagMinMatches: (n) => set({ favouriteTagMinMatches: n }),
  setDefaultFavouriteSource: (source) => set({ defaultFavouriteSource: source }),
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

/** Subscribe to myTags changes and persist via setConfig. */
export function subscribeToMyTagsChanges(setConfig: (key: 'myTags', value: MyTags) => Promise<unknown>) {
  let prev = useSettingsStore.getState().myTags
  return useSettingsStore.subscribe((state) => {
    if (state.myTags !== prev) {
      prev = state.myTags
      setConfig('myTags', state.myTags).catch(() => {})
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

/** Subscribe to missingBlacklist changes and persist via setConfig. */
export function subscribeToMissingBlacklistChanges(setConfig: (key: 'missingBlacklist', value: MissingBlacklist) => Promise<unknown>) {
  let prev = useSettingsStore.getState().missingBlacklist
  return useSettingsStore.subscribe((state) => {
    if (state.missingBlacklist !== prev) {
      prev = state.missingBlacklist
      setConfig('missingBlacklist', state.missingBlacklist).catch(() => {})
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

/** Subscribe to defaultFavouriteSource changes and persist via setConfig. */
export function subscribeToDefaultFavouriteSourceChanges(setConfig: (key: 'defaultFavouriteSource', value: string) => Promise<unknown>) {
  let prev = useSettingsStore.getState().defaultFavouriteSource
  return useSettingsStore.subscribe((state) => {
    if (state.defaultFavouriteSource !== prev) {
      prev = state.defaultFavouriteSource
      setConfig('defaultFavouriteSource', state.defaultFavouriteSource).catch(() => {})
    }
  })
}
