import { renderHook } from '@testing-library/react'
import { useSources, useSearchModes, useRankingOptions } from '@/hooks/useSourceOptions'

describe('useSourceOptions hooks', () => {
  it('useSources returns all 6 sources with labels', () => {
    const { result } = renderHook(() => useSources())
    expect(result.current).toHaveLength(6)
    expect(result.current[0]).toEqual({ value: 'hcomic', label: 'HComic' })
    expect(result.current[1]).toEqual({ value: 'moeimg', label: 'MoeImg' })
    expect(result.current[2]).toEqual({ value: 'jm', label: 'JM' })
    expect(result.current[3]).toEqual({ value: 'bika', label: '哔咔' })
    expect(result.current[4]).toEqual({ value: 'copymanga', label: '拷贝漫画' })
    expect(result.current[5]).toEqual({ value: 'nh', label: 'nhentai' })
  })

  it('useSearchModes returns all 5 modes', () => {
    const { result } = renderHook(() => useSearchModes())
    expect(result.current).toHaveLength(5)
    expect(result.current[0]).toEqual({ value: 'keyword', label: '关键词' })
    expect(result.current[1]).toEqual({ value: 'author', label: '作者' })
    expect(result.current[2]).toEqual({ value: 'tag', label: 'Tag' })
    expect(result.current[3]).toEqual({ value: 'ranking', label: '排行' })
    expect(result.current[4]).toEqual({ value: 'category', label: '分类' })
  })

  it('useRankingOptions returns all 16 options', () => {
    const { result } = renderHook(() => useRankingOptions())
    expect(result.current).toHaveLength(16)
    expect(result.current[0]).toEqual({ value: '日更新', label: '日更新' })
    expect(result.current[15]).toEqual({ value: '总收藏', label: '总收藏' })
  })

  it('hooks return stable references', () => {
    const { result, rerender } = renderHook(() => useSources())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })
})
