import type { ComicInfo } from '@shared/types'

export interface DuplicateGroup {
  comics: ComicInfo[]
  scores: Map<string, number>
}

/**
 * 组的代表指纹：取组内所有漫画 normalized title 的字典序最小值。
 * 与收藏分页返回顺序、成员增删无关（只要字典序最小的成员仍在组内）。
 * 空组返回空字符串作为边界保护。
 */
export function groupFingerprint(group: DuplicateGroup): string {
  if (group.comics.length === 0) return ''
  return group.comics
    .map(c => normalizeTitle(c.title))
    .sort()[0] ?? ''
}

/** Remove common bracket suffixes, whitespace, and normalize full-width chars. */
export function normalizeTitle(title: string): string {
  let s = title.trim()
  s = s.replace(/\u3000/g, ' ')
  let prev = ''
  let guard = 0
  while (prev !== s && guard < 10) {
    prev = s
    s = s.replace(/[（(\x5b][^（）()\x5b\]]*[）)\]]/g, '')
    guard++
  }
  s = s.replace(/[\uff01-\uff5e]/g, c =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  )
  return s.replace(/\s+/g, ' ').trim()
}

function lcsLength(a: string, b: string): number {
  const m = a.length
  const n = b.length
  let prev = new Uint16Array(n + 1)
  let curr = new Uint16Array(n + 1)
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1] + 1
        : Math.max(prev[j], curr[j - 1])
    }
    ;[prev, curr] = [curr, prev]
    curr.fill(0)
  }
  return prev[n]
}

/** LCS ratio: LCS length / max(len(a), len(b)). */
export function lcsRatio(a: string, b: string): number {
  if (!a || !b) return 0
  return lcsLength(a, b) / Math.max(a.length, b.length)
}

class UnionFind {
  private parent: Map<string, string>
  constructor(ids: Iterable<string>) {
    this.parent = new Map()
    for (const id of ids) this.parent.set(id, id)
  }
  find(x: string): string {
    let root = x
    while (this.parent.get(root) !== root) root = this.parent.get(root)!
    let cur = x
    while (cur !== root) {
      const next = this.parent.get(cur)!
      this.parent.set(cur, root)
      cur = next
    }
    return root
  }
  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

/**
 * Find groups of comics with similar titles using union-find.
 * Returns groups sorted by size descending.
 */
export function findDuplicateGroups(
  comics: ComicInfo[],
  threshold: number = 0.6
): DuplicateGroup[] {
  if (comics.length < 2) return []

  const normalized = comics.map(c => ({ comic: c, norm: normalizeTitle(c.title) }))
  const normByComicId = new Map<string, string>()
  for (const { comic, norm } of normalized) normByComicId.set(comic.id, norm)

  const uf = new UnionFind(comics.map(c => c.id))
  const maxScore = new Map<string, number>()

  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const score = lcsRatio(normalized[i].norm, normalized[j].norm)
      if (score >= threshold) {
        uf.union(normalized[i].comic.id, normalized[j].comic.id)
        const key = normalized[i].comic.id < normalized[j].comic.id
          ? `${normalized[i].comic.id}:${normalized[j].comic.id}`
          : `${normalized[j].comic.id}:${normalized[i].comic.id}`
        maxScore.set(key, score)
      }
    }
  }

  const groupMap = new Map<string, ComicInfo[]>()
  for (const { comic } of normalized) {
    const root = uf.find(comic.id)
    let arr = groupMap.get(root)
    if (!arr) { arr = []; groupMap.set(root, arr) }
    arr.push(comic)
  }

  const groups: DuplicateGroup[] = []
  for (const [, groupComics] of groupMap) {
    if (groupComics.length < 2) continue
    const scores = new Map<string, number>()
    for (const c of groupComics) {
      let best = 0
      for (const c2 of groupComics) {
        if (c.id === c2.id) continue
        const key = c.id < c2.id ? `${c.id}:${c2.id}` : `${c2.id}:${c.id}`
        best = Math.max(best, maxScore.get(key) ?? lcsRatio(normByComicId.get(c.id)!, normByComicId.get(c2.id)!))
      }
      scores.set(c.id, best)
    }
    groups.push({ comics: groupComics, scores })
  }

  groups.sort((a, b) => b.comics.length - a.comics.length)
  return groups
}
