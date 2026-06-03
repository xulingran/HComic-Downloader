import type { ComicInfo } from '@shared/types'

export interface DuplicateGroup {
  comics: ComicInfo[]
  scores: Map<string, number>
}

/** Remove common bracket suffixes, whitespace, and normalize full-width chars. */
export function normalizeTitle(title: string): string {
  let s = title.trim()
  // Remove common bracket patterns: （...） [...] (...) etc.
  s = s.replace(/[（(\[][^）)\]]*[）)\]]/g, '')
  // Full-width ASCII -> half-width
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
  const uf = new UnionFind(comics.map(c => c.id))
  const maxScore = new Map<string, number>()

  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const score = lcsRatio(normalized[i].norm, normalized[j].norm)
      if (score >= threshold) {
        uf.union(normalized[i].comic.id, normalized[j].comic.id)
        const key = `${normalized[i].comic.id}:${normalized[j].comic.id}`
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
        best = Math.max(best, maxScore.get(key) ?? lcsRatio(normalizeTitle(c.title), normalizeTitle(c2.title)))
      }
      scores.set(c.id, best)
    }
    groups.push({ comics: groupComics, scores })
  }

  groups.sort((a, b) => b.comics.length - a.comics.length)
  return groups
}
