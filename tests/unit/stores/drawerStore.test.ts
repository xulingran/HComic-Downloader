import { describe, it, expect, beforeEach } from 'vitest'
import { useDrawerStore } from '@/stores/useDrawerStore'
import type { ComicInfo } from '@shared/types'

const mockComic: ComicInfo = {
  id: '1',
  title: 'Test Comic',
  url: 'https://example.com/comic/1',
  coverUrl: 'https://example.com/cover.jpg',
  source: 'test'
}

describe('useDrawerStore', () => {
  beforeEach(() => {
    useDrawerStore.setState({
      drawerComic: null,
      pendingSearch: null,
      isOpen: false
    })
  })

  it('应有正确的初始状态', () => {
    const state = useDrawerStore.getState()
    expect(state.drawerComic).toBeNull()
    expect(state.pendingSearch).toBeNull()
    expect(state.isOpen).toBe(false)
  })

  it('应能打开 drawer 并设置 comic', () => {
    useDrawerStore.getState().openDrawer(mockComic)
    const state = useDrawerStore.getState()
    expect(state.drawerComic).toEqual(mockComic)
    expect(state.isOpen).toBe(true)
  })

  it('应能关闭 drawer', () => {
    useDrawerStore.getState().openDrawer(mockComic)
    useDrawerStore.getState().closeDrawer()
    const state = useDrawerStore.getState()
    expect(state.isOpen).toBe(false)
    expect(state.drawerComic).toEqual(mockComic)
  })

  it('应能设置 pendingSearch', () => {
    useDrawerStore.getState().setPendingSearch('test query', 'author')
    expect(useDrawerStore.getState().pendingSearch).toEqual({
      query: 'test query',
      mode: 'author'
    })
  })

  it('应能设置 pendingSearch 为 tag 模式', () => {
    useDrawerStore.getState().setPendingSearch('tag1', 'tag')
    expect(useDrawerStore.getState().pendingSearch).toEqual({
      query: 'tag1',
      mode: 'tag'
    })
  })

  it('应能清除 pendingSearch', () => {
    useDrawerStore.getState().setPendingSearch('query', 'keyword')
    useDrawerStore.getState().clearPendingSearch()
    expect(useDrawerStore.getState().pendingSearch).toBeNull()
  })
})
