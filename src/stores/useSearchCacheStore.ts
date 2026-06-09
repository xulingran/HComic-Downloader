import { create } from 'zustand'
import type { ComicInfo, PaginationInfo } from '@shared/types'

export interface SearchPageCache {
  query: string
  mode: string
  source: string
  searchTags: string
  comics: ComicInfo[]
  pagination: PaginationInfo | null
}

export interface SearchContextCache {
  pages: Record<number, SearchPageCache>
}

interface SearchContextInput {
  query: string
  mode: string
  source: string
  searchTags: string
}

interface SearchCacheStoreState {
  contexts: Record<string, SearchContextCache>
  currentContextKey: string | null
  currentPage: number
  hasCache: boolean
  setPage: (contextKey: string, page: number, data: SearchPageCache) => void
  getPage: (contextKey: string, page: number) => SearchPageCache | undefined
  hasPage: (contextKey: string, page: number) => boolean
  clearContext: (contextKey: string) => void
  clearCache: () => void
}

export function createSearchContextKey({ query, mode, source, searchTags }: SearchContextInput): string {
  return [source, mode, query.trim(), searchTags].join('\u001f')
}

export const useSearchCacheStore = create<SearchCacheStoreState>((set, get) => ({
  contexts: {},
  currentContextKey: null,
  currentPage: 1,
  hasCache: false,
  setPage: (contextKey, page, data) => {
    const contexts = get().contexts
    const context = contexts[contextKey] ?? { pages: {} }
    set({
      contexts: {
        ...contexts,
        [contextKey]: {
          pages: {
            ...context.pages,
            [page]: data,
          },
        },
      },
      currentContextKey: contextKey,
      currentPage: page,
      hasCache: true,
    })
  },
  getPage: (contextKey, page) => get().contexts[contextKey]?.pages[page],
  hasPage: (contextKey, page) => Boolean(get().contexts[contextKey]?.pages[page]),
  clearContext: (contextKey) => {
    const contexts = { ...get().contexts }
    delete contexts[contextKey]
    const currentContextKey = get().currentContextKey === contextKey ? null : get().currentContextKey
    set({
      contexts,
      currentContextKey,
      currentPage: currentContextKey ? get().currentPage : 1,
      hasCache: Object.keys(contexts).length > 0,
    })
  },
  clearCache: () => set({
    contexts: {},
    currentContextKey: null,
    currentPage: 1,
    hasCache: false,
  }),
}))
