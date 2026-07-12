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
      resumeInfo: null,
      isOpen: false
    })
  })

  it('应有正确的初始状态', () => {
    const state = useDrawerStore.getState()
    expect(state.drawerComic).toBeNull()
    expect(state.pendingSearch).toBeNull()
    expect(state.resumeInfo).toBeNull()
    expect(state.isOpen).toBe(false)
  })

  it('应能打开 drawer 并设置 comic', () => {
    useDrawerStore.getState().openDrawer(mockComic)
    const state = useDrawerStore.getState()
    expect(state.drawerComic).toEqual(mockComic)
    expect(state.isOpen).toBe(true)
    expect(state.resumeInfo).toBeNull()
  })

  it('openDrawer 可注入 resumeInfo 断点续读上下文', () => {
    useDrawerStore.getState().openDrawer(mockComic, { lastPage: 5, lastChapterId: 'ch3' })
    const state = useDrawerStore.getState()
    expect(state.resumeInfo).toEqual({ lastPage: 5, lastChapterId: 'ch3' })
  })

  it('closeDrawer 必须清空 resumeInfo', () => {
    useDrawerStore.getState().openDrawer(mockComic, { lastPage: 5 })
    useDrawerStore.getState().closeDrawer()
    const state = useDrawerStore.getState()
    expect(state.isOpen).toBe(false)
    expect(state.resumeInfo).toBeNull()
  })

  it('应能设置 pendingSearch', () => {
    useDrawerStore.getState().setPendingSearch('test query', 'author')
    expect(useDrawerStore.getState().pendingSearch).toEqual({
      query: 'test query',
      mode: 'author',
      append: false
    })
  })

  it('应能设置 pendingSearch 为 tag 模式', () => {
    useDrawerStore.getState().setPendingSearch('tag1', 'tag')
    expect(useDrawerStore.getState().pendingSearch).toEqual({
      query: 'tag1',
      mode: 'tag',
      append: false
    })
  })

  it('应能设置 pendingSearch 为追加模式', () => {
    useDrawerStore.getState().setPendingSearch('tag2', 'tag', true)
    expect(useDrawerStore.getState().pendingSearch).toEqual({
      query: 'tag2',
      mode: 'tag',
      append: true
    })
  })

  it('应能清除 pendingSearch', () => {
    useDrawerStore.getState().setPendingSearch('query', 'keyword')
    useDrawerStore.getState().clearPendingSearch()
    expect(useDrawerStore.getState().pendingSearch).toBeNull()
  })
})
