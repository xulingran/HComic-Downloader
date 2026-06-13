# 工具箱 - 收藏夹重复漫画检测 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增工具箱标签页，首个工具为收藏夹重复漫画检测（同来源、标题相似度）。

**Architecture:** 纯前端实现。前端逐页调用现有 `getFavourites` IPC 获取全量收藏，用 LCS 相似度算法分组，纵向展示结果，点击打开 `ComicInfoDrawer`。不新增后端接口。

**Tech Stack:** React 18, Zustand, Vitest, @testing-library/react

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `src/utils/titleSimilarity.ts` | 标题预处理、LCS 相似度计算、并查集分组 |
| `src/components/tools/DuplicateGroup.tsx` | 单个疑似重复分组的纵向展示 |
| `src/components/tools/DuplicateDetector.tsx` | 重复检测工具主组件（来源选择、数据获取、触发计算、结果展示） |
| `src/pages/ToolboxPage.tsx` | 工具箱页面壳，承载各工具卡片 |
| `tests/unit/utils/titleSimilarity.test.ts` | 相似度算法单元测试 |
| `tests/unit/components/DuplicateGroup.test.tsx` | 分组展示组件测试 |
| `tests/unit/components/DuplicateDetector.test.tsx` | 检测工具组件测试 |
| `tests/unit/pages/ToolboxPage.test.tsx` | 工具箱页面测试 |

### Modified files

| File | Change |
|------|--------|
| `src/components/Sidebar.tsx` | 添加工具箱菜单项 |
| `src/App.tsx` | 添加 toolbox case + import ToolboxPage |
| `tests/unit/components/Sidebar.test.tsx` | 更新菜单数量断言 |
| `tests/unit/App.test.tsx` | 添加 ToolboxPage mock + 导航测试 |

---

### Task 1: 标题相似度算法

**Files:**
- Create: `src/utils/titleSimilarity.ts`
- Test: `tests/unit/utils/titleSimilarity.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/utils/titleSimilarity.test.ts
import { describe, it, expect } from 'vitest'
import { normalizeTitle, lcsRatio, findDuplicateGroups } from '@/utils/titleSimilarity'
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
    // LCS of 'abcdef' and 'abcxyz' is 'abc', length 3, max len 6
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
      makeComic('1', '完全不同的标题A'),
      makeComic('2', '完全不同的标题B'),
    ]
    expect(findDuplicateGroups(comics)).toEqual([])
  })

  it('groups similar titles together', () => {
    const comics = [
      makeComic('1', '某作品名称'),
      makeComic('2', '某作品名称（全彩）'),
      makeComic('3', '完全无关的作品'),
    ]
    const groups = findDuplicateGroups(comics)
    expect(groups).toHaveLength(1)
    expect(groups[0].comics).toHaveLength(2)
    expect(groups[0].comics.map(c => c.id).sort()).toEqual(['1', '2'])
  })

  it('creates separate groups for separate clusters', () => {
    const comics = [
      makeComic('1', '作品A'),
      makeComic('2', '作品A（全彩）'),
      makeComic('3', '作品B'),
      makeComic('4', '作品B（汉化）'),
    ]
    const groups = findDuplicateGroups(comics)
    expect(groups).toHaveLength(2)
  })

  it('respects custom threshold', () => {
    const comics = [
      makeComic('1', 'abcdefghijkl'),
      makeComic('2', 'abcdefghxxxx'),
    ]
    // LCS ratio = 8/12 ≈ 0.667, above default 0.6
    expect(findDuplicateGroups(comics)).toHaveLength(1)
    // But below 0.7
    expect(findDuplicateGroups(comics, 0.7)).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/utils/titleSimilarity.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// src/utils/titleSimilarity.ts
import type { ComicInfo } from '@shared/types'

export interface DuplicateGroup {
  comics: ComicInfo[]
  scores: Map<string, number> // comicId -> max similarity score in group
}

/** Remove common bracket suffixes, whitespace, and normalize full-width chars. */
export function normalizeTitle(title: string): string {
  let s = title.trim()
  // Remove common bracket patterns: （...） [...] (...) （全彩） etc.
  s = s.replace(/[（(\[][^）)\]]*[）)\]]/g, '')
  // Full-width ASCII -> half-width
  s = s.replace(/[\uff01-\uff5e]/g, c =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  )
  return s.replace(/\s+/g, ' ').trim()
}

/** Compute LCS length between two strings. */
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

/** Union-Find for grouping similar comics. */
class UnionFind {
  private parent: Map<string, string>
  constructor(ids: Iterable<string>) {
    this.parent = new Map()
    for (const id of ids) this.parent.set(id, id)
  }
  find(x: string): string {
    let root = x
    while (this.parent.get(root) !== root) root = this.parent.get(root)!
    // Path compression
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
 * Find groups of comics with similar titles.
 * Returns groups sorted by size descending (most duplicates first).
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

  // Collect groups
  const groupMap = new Map<string, ComicInfo[]>()
  for (const { comic } of normalized) {
    const root = uf.find(comic.id)
    let arr = groupMap.get(root)
    if (!arr) { arr = []; groupMap.set(root, arr) }
    arr.push(comic)
  }

  // Filter to groups with 2+ comics, compute per-comic max score
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

  // Sort by group size descending
  groups.sort((a, b) => b.comics.length - a.comics.length)
  return groups
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/utils/titleSimilarity.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/titleSimilarity.ts tests/unit/utils/titleSimilarity.test.ts
git commit -m "feat: add title similarity utils with LCS algorithm"
```

---

### Task 2: DuplicateGroup 展示组件

**Files:**
- Create: `src/components/tools/DuplicateGroup.tsx`
- Test: `tests/unit/components/DuplicateGroup.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/unit/components/DuplicateGroup.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DuplicateGroup } from '@/components/tools/DuplicateGroup'
import type { ComicInfo } from '@shared/types'

const mockOpenDrawer = vi.fn()
vi.mock('@/stores/useDrawerStore', () => ({
  useDrawerStore: () => ({ openDrawer: mockOpenDrawer }),
}))

function makeComic(id: string, title: string): ComicInfo {
  return { id, title, url: '', coverUrl: `https://example.com/${id}.jpg`, source: 'hcomic' }
}

const sampleGroup = {
  comics: [makeComic('1', '标题A'), makeComic('2', '标题A（全彩）')],
  scores: new Map([['1', 0.85], ['2', 0.85]]),
}

describe('DuplicateGroup', () => {
  beforeEach(() => { mockOpenDrawer.mockClear() })

  it('renders group header with comic count', () => {
    render(<DuplicateGroup groupIndex={0} group={sampleGroup} />)
    expect(screen.getByText(/疑似重复组 1/)).toBeInTheDocument()
    expect(screen.getByText(/2 本/)).toBeInTheDocument()
  })

  it('renders all comic titles in full', () => {
    render(<DuplicateGroup groupIndex={0} group={sampleGroup} />)
    expect(screen.getByText('标题A')).toBeInTheDocument()
    expect(screen.getByText('标题A（全彩）')).toBeInTheDocument()
  })

  it('displays similarity percentage for each comic', () => {
    render(<DuplicateGroup groupIndex={0} group={sampleGroup} />)
    expect(screen.getByText('85%')).toBeInTheDocument()
  })

  it('calls openDrawer when a comic row is clicked', async () => {
    render(<DuplicateGroup groupIndex={0} group={sampleGroup} />)
    await userEvent.click(screen.getByText('标题A'))
    expect(mockOpenDrawer).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1', title: '标题A' })
    )
  })

  it('collapses and expands when header is clicked', async () => {
    render(<DuplicateGroup groupIndex={0} group={sampleGroup} />)
    // Comic rows visible by default
    expect(screen.getByText('标题A')).toBeInTheDocument()

    // Click header to collapse
    await userEvent.click(screen.getByText(/疑似重复组 1/))
    expect(screen.queryByText('标题A')).not.toBeInTheDocument()

    // Click header to expand
    await userEvent.click(screen.getByText(/疑似重复组 1/))
    expect(screen.getByText('标题A')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/components/DuplicateGroup.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```tsx
// src/components/tools/DuplicateGroup.tsx
import { useState } from 'react'
import type { ComicInfo } from '@shared/types'
import type { DuplicateGroup as DuplicateGroupType } from '@/utils/titleSimilarity'
import { useDrawerStore } from '@/stores/useDrawerStore'

interface DuplicateGroupProps {
  groupIndex: number
  group: DuplicateGroupType
}

export function DuplicateGroup({ groupIndex, group }: DuplicateGroupProps) {
  const [expanded, setExpanded] = useState(true)
  const openDrawer = useDrawerStore(s => s.openDrawer)

  return (
    <div className="bg-[var(--bg-primary)] rounded-xl shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3
                   hover:bg-[var(--bg-secondary)] transition-colors text-left"
      >
        <span className="text-sm font-medium text-[var(--text-primary)]">
          疑似重复组 {groupIndex + 1}（{group.comics.length} 本）
        </span>
        <span className="text-[var(--text-secondary)] text-xs">
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-[var(--border)] divide-y divide-[var(--border)]">
          {group.comics.map(comic => (
            <button
              key={comic.id}
              onClick={() => openDrawer(comic)}
              className="w-full flex items-center gap-3 px-4 py-2
                         hover:bg-[var(--bg-secondary)] transition-colors text-left"
            >
              <img
                src={comic.coverUrl}
                alt=""
                className="w-10 h-14 object-cover rounded flex-shrink-0 bg-[var(--bg-secondary)]"
              />
              <span className="flex-1 text-sm text-[var(--text-primary)] break-all">
                {comic.title}
              </span>
              <span className="text-xs text-[var(--text-secondary)] flex-shrink-0">
                {Math.round((group.scores.get(comic.id) ?? 0) * 100)}%
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/components/DuplicateGroup.test.tsx`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/tools/DuplicateGroup.tsx tests/unit/components/DuplicateGroup.test.tsx
git commit -m "feat: add DuplicateGroup component for displaying duplicate comics"
```

---

### Task 3: DuplicateDetector 检测工具组件

**Files:**
- Create: `src/components/tools/DuplicateDetector.tsx`
- Test: `tests/unit/components/DuplicateDetector.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/unit/components/DuplicateDetector.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DuplicateDetector } from '@/components/tools/DuplicateDetector'

const mockGetFavourites = vi.fn()

vi.mock('@/hooks/useIpc', () => ({
  useFavourites: () => ({ getFavourites: mockGetFavourites }),
}))

describe('DuplicateDetector', () => {
  beforeEach(() => {
    mockGetFavourites.mockReset()
    mockGetFavourites.mockResolvedValue({
      comics: [],
      pagination: { currentPage: 1, totalPages: 1, totalItems: 0 },
      needsLogin: false,
    })
  })

  it('renders source selector and start button', () => {
    render(<DuplicateDetector />)
    expect(screen.getByText('重复检测')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始检测' })).toBeInTheDocument()
  })

  it('shows empty state before detection', () => {
    render(<DuplicateDetector />)
    expect(screen.getByText('选择来源并点击开始检测')).toBeInTheDocument()
  })

  it('fetches all pages when detection starts', async () => {
    const comics = Array.from({ length: 5 }, (_, i) => ({
      id: String(i + 1),
      title: `作品${i + 1}`,
      url: '',
      coverUrl: '',
      source: 'hcomic',
    }))

    mockGetFavourites
      .mockResolvedValueOnce({
        comics: comics.slice(0, 3),
        pagination: { currentPage: 1, totalPages: 2, totalItems: 5 },
        needsLogin: false,
      })
      .mockResolvedValueOnce({
        comics: comics.slice(3),
        pagination: { currentPage: 2, totalPages: 2, totalItems: 5 },
        needsLogin: false,
      })

    render(<DuplicateDetector />)
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }))

    expect(mockGetFavourites).toHaveBeenCalledTimes(2)
    expect(mockGetFavourites).toHaveBeenNthCalledWith(1, 1, 'hcomic')
    expect(mockGetFavourites).toHaveBeenNthCalledWith(2, 2, 'hcomic')
  })

  it('shows no-duplicates message when none found', async () => {
    const comics = [
      { id: '1', title: '完全不同的标题A', url: '', coverUrl: '', source: 'hcomic' },
      { id: '2', title: '完全不同的标题B', url: '', coverUrl: '', source: 'hcomic' },
    ]
    mockGetFavourites.mockResolvedValueOnce({
      comics,
      pagination: { currentPage: 1, totalPages: 1, totalItems: 2 },
      needsLogin: false,
    })

    render(<DuplicateDetector />)
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }))

    expect(await screen.findByText('未发现疑似重复的漫画')).toBeInTheDocument()
  })

  it('displays duplicate groups when found', async () => {
    const comics = [
      { id: '1', title: '某作品名称', url: '', coverUrl: '', source: 'hcomic' },
      { id: '2', title: '某作品名称（全彩）', url: '', coverUrl: '', source: 'hcomic' },
    ]
    mockGetFavourites.mockResolvedValueOnce({
      comics,
      pagination: { currentPage: 1, totalPages: 1, totalItems: 2 },
      needsLogin: false,
    })

    render(<DuplicateDetector />)
    await userEvent.click(screen.getByRole('button', { name: '开始检测' }))

    expect(await screen.findByText(/疑似重复组 1/)).toBeInTheDocument()
    expect(screen.getByText('某作品名称')).toBeInTheDocument()
    expect(screen.getByText('某作品名称（全彩）')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/components/DuplicateDetector.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```tsx
// src/components/tools/DuplicateDetector.tsx
import { useState, useCallback } from 'react'
import type { ComicInfo } from '@shared/types'
import { useFavourites } from '@/hooks/useIpc'
import { findDuplicateGroups, type DuplicateGroup } from '@/utils/titleSimilarity'
import { DuplicateGroup as DuplicateGroupView } from './DuplicateGroup'

const sources = [
  { value: 'hcomic', label: 'HComic' },
  { value: 'moeimg', label: 'MoeImg' },
  { value: 'jmcomic', label: 'jmcomic' },
]

type DetectionStatus = 'idle' | 'fetching' | 'computing' | 'done'

export function DuplicateDetector() {
  const { getFavourites } = useFavourites()
  const [source, setSource] = useState('hcomic')
  const [status, setStatus] = useState<DetectionStatus>('idle')
  const [progress, setProgress] = useState('')
  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [totalFetched, setTotalFetched] = useState(0)

  const handleDetect = useCallback(async () => {
    setStatus('fetching')
    setGroups([])
    setTotalFetched(0)

    try {
      // Fetch page 1 to get total pages
      const first = await getFavourites(1, source)
      const totalPages = first.pagination?.totalPages ?? 1
      const allComics: ComicInfo[] = [...first.comics]
      setProgress(`正在获取第 1/${totalPages} 页...`)

      // Fetch remaining pages
      for (let page = 2; page <= totalPages; page++) {
        try {
          const result = await getFavourites(page, source)
          allComics.push(...result.comics)
          setProgress(`正在获取第 ${page}/${totalPages} 页...`)
        } catch {
          // Skip failed pages
        }
      }

      setTotalFetched(allComics.length)
      setStatus('computing')
      setProgress('正在计算相似度...')

      // Compute duplicate groups
      const duplicateGroups = findDuplicateGroups(allComics)
      setGroups(duplicateGroups)
      setStatus('done')
    } catch {
      setStatus('done')
    }
  }, [getFavourites, source])

  return (
    <div className="bg-[var(--bg-primary)] rounded-xl p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
        <h3 className="text-base font-medium text-[var(--text-primary)]">重复检测</h3>
      </div>

      <p className="text-sm text-[var(--text-secondary)]">
        分析收藏夹中标题相似的漫画，找出可能重复的条目。点击漫画可打开详情抽屉。
      </p>

      <div className="flex items-center gap-3">
        <select
          value={source}
          onChange={e => setSource(e.target.value)}
          disabled={status === 'fetching' || status === 'computing'}
          className="px-3 py-1.5 text-sm bg-[var(--bg-secondary)] border border-[var(--border)]
                     rounded-lg text-[var(--text-primary)]"
        >
          {sources.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>

        <button
          onClick={handleDetect}
          disabled={status === 'fetching' || status === 'computing'}
          className="px-4 py-1.5 rounded-lg bg-[var(--accent)] text-white text-sm
                     disabled:opacity-50 hover:bg-[var(--accent-hover)] transition-colors"
        >
          {status === 'fetching' || status === 'computing' ? progress : '开始检测'}
        </button>

        {status === 'done' && totalFetched > 0 && (
          <span className="text-sm text-[var(--text-secondary)]">
            已分析 {totalFetched} 本漫画，发现 {groups.length} 组疑似重复
          </span>
        )}
      </div>

      {/* Results */}
      {status === 'idle' && (
        <p className="text-sm text-[var(--text-secondary)] py-4 text-center">
          选择来源并点击开始检测
        </p>
      )}

      {status === 'done' && groups.length === 0 && totalFetched > 0 && (
        <p className="text-sm text-[var(--text-secondary)] py-4 text-center">
          未发现疑似重复的漫画
        </p>
      )}

      {groups.length > 0 && (
        <div className="space-y-3">
          {groups.map((group, i) => (
            <DuplicateGroupView key={i} groupIndex={i} group={group} />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/components/DuplicateDetector.test.tsx`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/tools/DuplicateDetector.tsx tests/unit/components/DuplicateDetector.test.tsx
git commit -m "feat: add DuplicateDetector tool component"
```

---

### Task 4: 工具箱页面 + 导航集成

**Files:**
- Create: `src/pages/ToolboxPage.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`
- Create: `tests/unit/pages/ToolboxPage.test.tsx`
- Modify: `tests/unit/components/Sidebar.test.tsx`
- Modify: `tests/unit/App.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/unit/pages/ToolboxPage.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/hooks/useIpc', () => ({
  useFavourites: () => ({
    getFavourites: vi.fn().mockResolvedValue({
      comics: [],
      pagination: { currentPage: 1, totalPages: 1, totalItems: 0 },
      needsLogin: false,
    }),
  }),
}))

import { ToolboxPage } from '@/pages/ToolboxPage'

describe('ToolboxPage', () => {
  it('renders page title', () => {
    render(<ToolboxPage />)
    expect(screen.getByText('工具箱')).toBeInTheDocument()
  })

  it('renders the duplicate detector tool', () => {
    render(<ToolboxPage />)
    expect(screen.getByText('重复检测')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/pages/ToolboxPage.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Create ToolboxPage**

```tsx
// src/pages/ToolboxPage.tsx
import { DuplicateDetector } from '../components/tools/DuplicateDetector'

export function ToolboxPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-[var(--text-primary)]">
        工具箱
      </h2>

      <div className="space-y-4">
        <DuplicateDetector />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Update Sidebar to add toolbox menu item**

In `src/components/Sidebar.tsx`, add a new entry to the `menuItems` array. Insert it between `history` and `settings`:

```ts
// Updated menuItems array:
const menuItems = [
  { id: 'search', label: '搜索', icon: '🔍' },
  { id: 'downloads', label: '下载管理', icon: '📥' },
  { id: 'favourites', label: '收藏夹', icon: '⭐' },
  { id: 'history', label: '历史记录', icon: '🕐' },
  { id: 'toolbox', label: '工具箱', icon: '🧰' },
  { id: 'settings', label: '设置', icon: '⚙️' }
]
```

- [ ] **Step 5: Update App.tsx to import ToolboxPage and add route**

In `src/App.tsx`:

Add import after the SettingsPage import (line 10):
```ts
import { ToolboxPage } from './pages/ToolboxPage'
```

Add case in the `renderPage` switch (before the `default` case):
```ts
case 'toolbox':
  return <ToolboxPage />
```

- [ ] **Step 6: Update Sidebar test**

In `tests/unit/components/Sidebar.test.tsx`:

Update `menuItems` array in the test file to match the new 6-item list:
```ts
const menuItems = [
  { id: 'search', label: '搜索', icon: '🔍' },
  { id: 'downloads', label: '下载管理', icon: '📥' },
  { id: 'favourites', label: '收藏夹', icon: '⭐' },
  { id: 'history', label: '历史记录', icon: '🕐' },
  { id: 'toolbox', label: '工具箱', icon: '🧰' },
  { id: 'settings', label: '设置', icon: '⚙️' }
]
```

Update the button count assertion:
```ts
expect(buttons).toHaveLength(6)
```

- [ ] **Step 7: Update App test**

In `tests/unit/App.test.tsx`:

Add ToolboxPage mock after the SettingsPage mock:
```ts
vi.mock('@/pages/ToolboxPage', () => ({
  ToolboxPage: () => <div data-testid="toolbox-page">Toolbox Page</div>
}))
```

Add toolbox navigation button in the Sidebar mock:
```ts
<button onClick={() => onPageChange('history')}>History</button>
<button onClick={() => onPageChange('toolbox')}>Toolbox</button>
<button onClick={() => onPageChange('settings')}>Settings</button>
```

Add a new test case:
```ts
it('switches to toolbox page when Toolbox button clicked', async () => {
  render(<App />)

  await userEvent.click(screen.getByText('Toolbox'))

  expect(screen.getByTestId('toolbox-page')).toBeInTheDocument()
  expect(screen.getByTestId('active-page')).toHaveTextContent('toolbox')
})
```

- [ ] **Step 8: Run all tests**

Run: `npx vitest run`
Expected: All PASS

- [ ] **Step 9: Commit**

```bash
git add src/pages/ToolboxPage.tsx src/components/Sidebar.tsx src/App.tsx \
        tests/unit/pages/ToolboxPage.test.tsx \
        tests/unit/components/Sidebar.test.tsx \
        tests/unit/App.test.tsx
git commit -m "feat: add Toolbox page with navigation integration"
```

---

## Self-Review

### Spec Coverage
- ✅ New "工具箱" tab → Task 4 (Sidebar, App, ToolboxPage)
- ✅ 工具卡片列表结构 → Task 4 (ToolboxPage with DuplicateDetector)
- ✅ 来源选择 + 开始检测 → Task 3 (DuplicateDetector)
- ✅ 逐页获取全量收藏 → Task 3 (handleDetect)
- ✅ 进度指示器 → Task 3 (progress state)
- ✅ 标题预处理 → Task 1 (normalizeTitle)
- ✅ LCS 相似度算法 → Task 1 (lcsRatio)
- ✅ 并查集分组 → Task 1 (UnionFind + findDuplicateGroups)
- ✅ 纵向分组展示 + 完整标题 → Task 2 (DuplicateGroup)
- ✅ 点击打开详情抽屉 → Task 2 (openDrawer)
- ✅ 空状态引导文案 → Task 3 (idle/done states)
- ✅ 容错（跳过失败页） → Task 3 (try/catch in page loop)

### Placeholder Scan
- ✅ No TBD, TODO, "implement later"
- ✅ All code blocks contain complete implementations
- ✅ All test assertions are concrete

### Type Consistency
- ✅ `DuplicateGroup` type defined in titleSimilarity.ts, imported in DuplicateGroup.tsx and DuplicateDetector.tsx
- ✅ `ComicInfo` imported from `@shared/types` consistently
- ✅ `openDrawer` from `useDrawerStore` used in DuplicateGroup.tsx
- ✅ `getFavourites` from `useFavourites` used in DuplicateDetector.tsx
