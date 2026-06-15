import { describe, it, expect } from 'vitest'
import { normalizeTitle, lcsRatio, findDuplicateGroups, groupFingerprint } from '@/utils/titleSimilarity'
import type { ComicInfo } from '@shared/types'

function makeComic(id: string, title: string): ComicInfo {
  return { id, title, url: '', coverUrl: '', source: 'hcomic' }
}

describe('normalizeTitle', () => {
  it('removes common bracket suffixes', () => {
    expect(normalizeTitle('某作品（全彩）')).toBe('某作品')
    expect(normalizeTitle('某作品[汉化组名]')).toBe('某作品')
    expect(normalizeTitle('某作品 (Chinese)')).toBe('某作品')
  })

  it('removes extra whitespace', () => {
    expect(normalizeTitle('  某作品  ')).toBe('某作品')
  })

  it('converts full-width to half-width', () => {
    expect(normalizeTitle('ＡＢＣ')).toBe('ABC')
  })

  it('returns original title when no cleanup needed', () => {
    expect(normalizeTitle('普通标题')).toBe('普通标题')
  })
})

describe('lcsRatio', () => {
  it('returns 1 for identical strings', () => {
    expect(lcsRatio('abc', 'abc')).toBe(1)
  })

  it('returns 0 for completely different strings', () => {
    expect(lcsRatio('abc', 'xyz')).toBe(0)
  })

  it('returns correct ratio for partial match', () => {
    expect(lcsRatio('abcdef', 'abcxyz')).toBeCloseTo(0.5)
  })

  it('handles empty strings', () => {
    expect(lcsRatio('', 'abc')).toBe(0)
    expect(lcsRatio('abc', '')).toBe(0)
    expect(lcsRatio('', '')).toBe(0)
  })
})

describe('findDuplicateGroups', () => {
  it('returns empty array when no comics', () => {
    expect(findDuplicateGroups([])).toEqual([])
  })

  it('returns empty array when no duplicates', () => {
    const comics = [
      makeComic('1', '魔法少女物语'),
      makeComic('2', '异世界冒险记'),
    ]
    expect(findDuplicateGroups(comics)).toEqual([])
  })

  it('groups similar titles together', () => {
    const comics = [
      makeComic('1', '魔法少女物语'),
      makeComic('2', '魔法少女物语（全彩）'),
      makeComic('3', '异世界冒险记'),
    ]
    const groups = findDuplicateGroups(comics)
    expect(groups).toHaveLength(1)
    expect(groups[0].comics).toHaveLength(2)
    expect(groups[0].comics.map(c => c.id).sort()).toEqual(['1', '2'])
  })

  it('creates separate groups for separate clusters', () => {
    const comics = [
      makeComic('1', '魔法少女物语'),
      makeComic('2', '魔法少女物语（全彩）'),
      makeComic('3', '异世界冒险记'),
      makeComic('4', '异世界冒险记（汉化）'),
    ]
    const groups = findDuplicateGroups(comics)
    expect(groups).toHaveLength(2)
  })

  it('respects custom threshold', () => {
    const comics = [
      makeComic('1', 'abcdefghijkl'),
      makeComic('2', 'abcdefghxxxx'),
    ]
    expect(findDuplicateGroups(comics)).toHaveLength(1)
    expect(findDuplicateGroups(comics, 0.7)).toHaveLength(0)
  })
})

describe('groupFingerprint', () => {
  it('returns the lexicographically smallest normalized title', () => {
    const group = {
      comics: [makeComic('1', 'cherry'), makeComic('2', 'apple'), makeComic('3', 'banana')],
      scores: new Map(),
    }
    expect(groupFingerprint(group)).toBe('apple')
  })

  it('is independent of member input order', () => {
    const makeGroup = (order: string[]) => ({
      comics: order.map(t => makeComic(t, t)),
      scores: new Map(),
    })
    const fp1 = groupFingerprint(makeGroup(['zebra', 'apple', 'mango']))
    const fp2 = groupFingerprint(makeGroup(['mango', 'zebra', 'apple']))
    const fp3 = groupFingerprint(makeGroup(['apple', 'mango', 'zebra']))
    expect(fp1).toBe(fp2)
    expect(fp2).toBe(fp3)
    expect(fp1).toBe('apple')
  })

  it('is unaffected by changes to non-minimum members', () => {
    // 字典序最小成员 apple 仍在组内，其他成员变化不影响指纹
    const group = {
      comics: [makeComic('1', 'apple'), makeComic('2', 'zebra-renamed')],
      scores: new Map(),
    }
    expect(groupFingerprint(group)).toBe('apple')
  })

  it('normalizes titles before comparing', () => {
    // （全彩）后缀被抹平，归一化后仍为最小
    const group = {
      comics: [makeComic('1', 'banana'), makeComic('2', 'apple（全彩）')],
      scores: new Map(),
    }
    expect(groupFingerprint(group)).toBe('apple')
  })

  it('returns empty string for empty group', () => {
    const group = { comics: [], scores: new Map() }
    expect(groupFingerprint(group)).toBe('')
  })
})
