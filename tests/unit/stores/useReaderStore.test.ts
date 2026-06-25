import { describe, it, expect, beforeEach } from 'vitest'
import { useReaderStore } from '@/stores/useReaderStore'
import type { ComicInfo } from '@shared/types'

const comic: ComicInfo = {
  id: '999001', title: 'Multi', url: 'https://x/1', coverUrl: '', source: 'JM', sourceSite: 'jm',
}

describe('useReaderStore', () => {
  beforeEach(() => {
    useReaderStore.getState().closeReader()
  })

  it('openReader stores comic, page and chapter', () => {
    useReaderStore.getState().openReader(comic, 3, '999002')
    const s = useReaderStore.getState()
    expect(s.readerComic).toEqual(comic)
    expect(s.initialPage).toBe(3)
    expect(s.initialChapterId).toBe('999002')
  })

  it('openReader defaults page and chapter to null', () => {
    useReaderStore.getState().openReader(comic)
    const s = useReaderStore.getState()
    expect(s.initialPage).toBeNull()
    expect(s.initialChapterId).toBeNull()
  })

  it('closeReader clears all', () => {
    useReaderStore.getState().openReader(comic, 3, '999002')
    useReaderStore.getState().closeReader()
    const s = useReaderStore.getState()
    expect(s.readerComic).toBeNull()
    expect(s.initialPage).toBeNull()
    expect(s.initialChapterId).toBeNull()
  })
})
