import { describe, it, expect } from 'vitest'
import { normalizeTitle, lcsRatio, findDuplicateGroups, groupFingerprint, extractAlbumTitle } from '@/utils/titleSimilarity'
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

describe('extractAlbumTitle', () => {
  it('提取同一作品的不同章节的作品名主体（保留作者前缀）', () => {
    const titles = [
      '[作者A] 某作品 第1话',
      '[作者A] 某作品 第2话',
      '[作者A] 某作品 第3话',
    ]
    expect(extractAlbumTitle(titles)).toBe('[作者A] 某作品')
  })

  it('无作者前缀但作品名相同时返回作品名', () => {
    expect(extractAlbumTitle(['某作品 第1话', '某作品 第2话'])).toBe('某作品')
  })

  it('token 顺序不同但集合相同仍能提取', () => {
    expect(extractAlbumTitle(['[作者A] 作品 第1话', '作品 第2话 [作者A]'])).toBe('[作者A] 作品')
  })

  it('无空格的作者前缀仍保留作者', () => {
    expect(extractAlbumTitle(['[作者A]某作品 第1话', '[作者A]某作品 第2话'])).toBe('[作者A]某作品')
  })

  it('仅部分标题带方括号开头时不保留作者前缀', () => {
    // 交集仅 "作品"，[作者A] 不应作为前缀
    expect(extractAlbumTitle(['[作者A] 作品 第1话', '作品 第2话'])).toBe('作品')
  })

  it('选中数 < 2 时返回 null', () => {
    expect(extractAlbumTitle(['单本标题'])).toBeNull()
    expect(extractAlbumTitle([])).toBeNull()
  })

  it('完全无共有的标题返回 null', () => {
    expect(extractAlbumTitle(['完全不同的标题甲', '毫无关联的标题乙'])).toBeNull()
  })

  it('交集为空且字符级公共前缀过短返回 null', () => {
    expect(extractAlbumTitle(['第1话', '第2话'])).toBeNull()
  })

  it('交集为空但存在字符级公共前缀时回退到公共前缀', () => {
    // 无空格，集合交集为空，但字符级公共前缀为 "某作品第"
    expect(extractAlbumTitle(['某作品第1话', '某作品第2话'])).toBe('某作品第')
  })

  it('提取结果 trim 后长度小于 2 时返回 null', () => {
    // 构造交集为单字符的情况：两个标题共享 token "A"，结果为 "A" 长度 1
    expect(extractAlbumTitle(['A xxx', 'A yyy'])).toBeNull()
  })

  it('作者前缀与公共前缀回退路径结合时正确拼回', () => {
    // 无空格但有公共作者前缀 + 字符级公共前缀
    expect(extractAlbumTitle(['[作者]某作品1', '[作者]某作品2'])).toBe('[作者]某作品')
  })

  it('忽略空白/空标题条目', () => {
    expect(extractAlbumTitle(['某作品 第1话', '  ', '', '某作品 第2话'])).toBe('某作品')
  })

  it('多个共有 token 按首标题顺序稳定输出', () => {
    expect(extractAlbumTitle(['[社团X] 作者Y 作品 第1话', '[社团X] 作者Y 作品 第2话'])).toBe('[社团X] 作者Y 作品')
  })

  it('连字符分隔的标题能提取尾部共有片段', () => {
    // 用户真实 case：三本漫画前缀各不相同，共有部分在尾部
    expect(extractAlbumTitle([
      '偷袭观者-困困觉',
      '观者-结末-困困觉',
      '玄尘佛母-无相法身-困困觉',
    ])).toBe('困困觉')
  })

  it('混合分隔符（空格 + 连字符）能正确分词', () => {
    // 空格和连字符混用，交集应正确求出
    expect(extractAlbumTitle(['作品名 第1话', '作品名-第2话'])).toBe('作品名')
  })

  it('连字符分隔且作者前缀相同时保留作者', () => {
    // [社团X] 与 系列A 紧连无分隔符，作为单个 token；作者前缀已隐含，不重复加空格
    expect(extractAlbumTitle(['[社团X]系列A-第1话', '[社团X]系列A-第2话'])).toBe('[社团X]系列A')
  })

  it('下划线作为分隔符', () => {
    expect(extractAlbumTitle(['作者_作品_1', '作者_作品_2'])).toBe('作者 作品')
  })
})
