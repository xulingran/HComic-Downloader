# 来源统一管理设计规范

## 问题描述

前端有 14 处硬编码来源列表，分布在 10+ 个文件中。每次添加新来源需要修改多处，容易遗漏。

### 硬编码清单

| # | 文件 | 行号 | 类型 |
|---|------|------|------|
| 1 | `src/components/SearchBar.tsx` | 12-18 | `const sources = [...]` |
| 2 | `src/pages/FavouritesPage.tsx` | 20-26 | `const sources = [...]` |
| 3 | `src/components/tools/DuplicateDetector.tsx` | 7-13 | `const sources = [...]` |
| 4 | `src/pages/SettingsPage.tsx` | 404 | `['hcomic', 'moeimg', 'bika', 'copymanga'].map(...)` |
| 5 | `src/pages/SettingsPage.tsx` | 414 | 三元链标签映射 |
| 6 | `src/components/settings/TagFilterSettings.tsx` | 10-16 | `const SOURCES = [...]` |
| 7 | `src/components/ComicInfoDrawer.tsx` | 39 | `const sourceKeyMap = {...}` |
| 8 | `src/stores/useSettingsStore.ts` | 26 | `DEFAULT_TAG_BLACKLIST` 对象字面量 |
| 9 | `src/hooks/useInitConfig.ts` | 26-31 | `normalized` 对象字面量 |
| 10 | `src/utils/source.ts` | 11-15 | `normalizeSourceKey()` if/else 链 |
| 11 | `src/utils/auth.ts` | 4 | `AUTH_REQUIRED_SOURCES` Set |
| 12 | `src/pages/SearchPage.tsx` | 349 | `source === 'hcomic' \|\| source === 'jmcomic'` |
| 13 | `shared/types.ts` | 80, 197 | `tagBlacklist` 类型定义 |
| 14 | `electron/validators.ts` | 198-226 | `tagBlacklist()` 验证器 |

## 解决方案

### 核心思路

1. **单一来源常量** — `shared/types.ts` 中已有 `COMIC_SOURCES`，作为唯一真相源
2. **来源元数据** — 新增 `SOURCE_META` 对象，集中管理标签、能力标志
3. **类型驱动** — 用 `ComicSource` 类型替代散落的字符串字面量
4. **前端 Hooks** — 提供 UI 选项数组，组件直接使用
5. **工具函数** — 封装常用查询（标签、能力判断）

### 架构层次

```
shared/types.ts          ← COMIC_SOURCES + ComicSource + SOURCE_META（唯一真相源）
    ↓
src/hooks/useSourceOptions.ts  ← useSources(), useSearchModes()（UI 选项）
src/utils/source.ts            ← sourceLabel(), sourceSupports*()（工具函数）
    ↓
各组件                   ← 消费 hooks 和工具函数
```

---

## 详细设计

### Step 1: 扩展 shared/types.ts

在已有 `COMIC_SOURCES` 和 `ComicSource` 基础上，添加来源元数据：

```typescript
/** 来源元数据 — 集中管理标签和能力标志 */
export const SOURCE_META = {
  hcomic: {
    label: 'HComic',
    supportsRandom: true,
    supportsFavourites: true,
    requiresAuth: false,
  },
  moeimg: {
    label: 'MoeImg',
    supportsRandom: false,
    supportsFavourites: true,
    requiresAuth: false,
  },
  jmcomic: {
    label: '禁漫天堂',
    supportsRandom: true,
    supportsFavourites: true,
    requiresAuth: true,
  },
  bika: {
    label: '哔咔',
    supportsRandom: false,
    supportsFavourites: true,
    requiresAuth: false,
  },
  copymanga: {
    label: '拷贝漫画',
    supportsRandom: false,
    supportsFavourites: false,
    requiresAuth: false,
  },
} as const satisfies Record<ComicSource, {
  label: string
  supportsRandom: boolean
  supportsFavourites: boolean
  requiresAuth: boolean
}>

/** 来源标签映射（便捷访问） */
export const SOURCE_LABELS: Record<ComicSource, string> =
  Object.fromEntries(
    Object.entries(SOURCE_META).map(([k, v]) => [k, v.label])
  ) as Record<ComicSource, string>

/** 有收藏夹支持的来源列表 */
export const SOURCES_WITH_FAVOURITES = COMIC_SOURCES.filter(
  s => SOURCE_META[s].supportsFavourites
)

/** 需要认证的来源列表 */
export const AUTH_REQUIRED_SOURCES = COMIC_SOURCES.filter(
  s => SOURCE_META[s].requiresAuth
)
```

同时，将 `tagBlacklist` 类型改为基于 `ComicSource`：

```typescript
// 替代原来的 { hcomic: string[]; moeimg: string[]; jmcomic: string[]; bika: string[]; copymanga: string[] }
export type TagBlacklist = Record<ComicSource, string[]>
```

### Step 2: 创建 src/hooks/useSourceOptions.ts

```typescript
import { useMemo } from 'react'
import { COMIC_SOURCES, SEARCH_MODES, SOURCE_LABELS } from '@shared/types'

interface Option {
  value: string
  label: string
}

const SEARCH_MODE_LABELS: Record<string, string> = {
  keyword: '关键词',
  author: '作者',
  tag: 'Tag',
  ranking: '排行',
}

const RANKING_OPTIONS_LIST = [
  '日更新', '周更新', '月更新', '总更新',
  '日点击', '周点击', '月点击', '总点击',
  '日评分', '周评分', '月评分', '总评分',
  '日收藏', '周收藏', '月收藏', '总收藏',
]

/** 返回带标签的来源列表 */
export function useSources(): Option[] {
  return useMemo(() =>
    COMIC_SOURCES.map(s => ({ value: s, label: SOURCE_LABELS[s] })),
  [])
}

/** 返回带标签的搜索模式列表 */
export function useSearchModes(): Option[] {
  return useMemo(() =>
    SEARCH_MODES.map(m => ({ value: m, label: SEARCH_MODE_LABELS[m] ?? m })),
  [])
}

/** 返回带标签的排行选项列表 */
export function useRankingOptions(): Option[] {
  return useMemo(() =>
    RANKING_OPTIONS_LIST.map(r => ({ value: r, label: r })),
  [])
}
```

### Step 3: 重构 src/utils/source.ts

```typescript
import { COMIC_SOURCES, SOURCE_LABELS, SOURCE_META, type ComicSource, type TagBlacklist } from '@shared/types'

/** 获取来源标签 */
export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source as ComicSource] ?? source
}

/** 来源是否支持随机 */
export function sourceSupportsRandom(source: string): boolean {
  return SOURCE_META[source as ComicSource]?.supportsRandom ?? false
}

/** 来源是否支持收藏夹 */
export function sourceSupportsFavourites(source: string): boolean {
  return SOURCE_META[source as ComicSource]?.supportsFavourites ?? false
}

/** 来源是否需要认证 */
export function sourceRequiresAuth(source: string): boolean {
  return SOURCE_META[source as ComicSource]?.requiresAuth ?? false
}

/**
 * Normalize a source identifier to a valid ComicSource.
 * Unknown sources default to 'hcomic'.
 */
export function normalizeSourceKey(source: string): ComicSource {
  return COMIC_SOURCES.includes(source as ComicSource) ? source as ComicSource : 'hcomic'
}
```

### Step 4: 简化 src/utils/auth.ts

```typescript
import { IPC_ERROR_CODES } from '@shared/types'
import { sourceRequiresAuth } from './source'

/** 判断来源是否需要预验证认证 */
export function requiresAuth(source: string): boolean {
  return sourceRequiresAuth(source)
}

/** 判断 IPC 错误是否为认证失败 */
export function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return (err as Record<string, unknown>)?.code === IPC_ERROR_CODES.AUTH_REQUIRED
    || msg.includes('AUTH_REQUIRED')
    || msg.includes('401')
    || msg.includes('403')
}
```

### Step 5: 更新组件

#### SearchBar.tsx
```diff
-const sources = [
-  { value: 'hcomic', label: 'HComic' },
-  { value: 'moeimg', label: 'Moeimg' },
-  { value: 'jmcomic', label: '禁漫天堂' },
-  { value: 'bika', label: '哔咔' },
-  { value: 'copymanga', label: '拷贝漫画' }
-]
+import { useSources, useSearchModes, useRankingOptions } from '../hooks/useSourceOptions'
+
+// 在组件内部
+const sources = useSources()
+const searchModes = useSearchModes()
+const rankingOptions = useRankingOptions()
```

同时更新 `showRandom` 条件：
```diff
-showRandom={source === 'hcomic' || source === 'jmcomic'}
+import { sourceSupportsRandom } from '../utils/source'
+showRandom={sourceSupportsRandom(source)}
```

#### FavouritesPage.tsx
```diff
-const sources = [
-  { value: 'hcomic', label: 'HComic' },
-  ...
-]
+import { useSources } from '../hooks/useSourceOptions'
+const sources = useSources()
```

#### DuplicateDetector.tsx
```diff
-const sources = [
-  { value: 'hcomic', label: 'HComic' },
-  ...
-]
+import { useSources } from '@/hooks/useSourceOptions'
+const sources = useSources()
```

#### TagFilterSettings.tsx
```diff
-const SOURCES = [
-  { key: 'hcomic' as const, label: 'HComic' },
-  ...
-]
+import { COMIC_SOURCES, SOURCE_LABELS, type ComicSource } from '@shared/types'
+import { useSources } from '@/hooks/useSourceOptions'
+const sources = useSources()
```

#### SettingsPage.tsx
```diff
-{['hcomic', 'moeimg', 'bika', 'copymanga'].map((source) => (
+import { COMIC_SOURCES, SOURCE_LABELS } from '@shared/types'
+{COMIC_SOURCES.map((source) => (
   <button ...>
-    {source === 'hcomic' ? 'HComic' : source === 'moeimg' ? 'Moeimg' : source === 'bika' ? '哔咔' : '拷贝漫画'}
+    {SOURCE_LABELS[source]}
   </button>
 ))}
```

#### ComicInfoDrawer.tsx
```diff
-const sourceKeyMap: Record<string, keyof TagBlacklist> = { moeimg: 'moeimg', jmcomic: 'jmcomic', bika: 'bika', copymanga: 'copymanga' }
+import { normalizeSourceKey } from '@/utils/source'
-const key = sourceKeyMap[comicSource] ?? 'hcomic'
+const key = normalizeSourceKey(comicSource)
```

#### useSettingsStore.ts
```diff
-const DEFAULT_TAG_BLACKLIST: TagBlacklist = { hcomic: [], moeimg: [], jmcomic: [], bika: [], copymanga: [] }
+import { COMIC_SOURCES, type TagBlacklist } from '@shared/types'
+const DEFAULT_TAG_BLACKLIST: TagBlacklist = Object.fromEntries(
+  COMIC_SOURCES.map(s => [s, []])
+) as TagBlacklist
```

#### useInitConfig.ts
```diff
-const normalized: { hcomic: string[]; moeimg: string[]; jmcomic: string[]; bika: string[]; copymanga: string[] } = {
-  hcomic: Array.isArray(raw.hcomic) ? raw.hcomic as string[] : [],
-  moeimg: Array.isArray(raw.moeimg) ? raw.moeimg as string[] : [],
-  jmcomic: Array.isArray(raw.jmcomic) ? raw.jmcomic as string[] : [],
-  bika: Array.isArray(raw.bika) ? raw.bika as string[] : [],
-  copymanga: Array.isArray(raw.copymanga) ? raw.copymanga as string[] : [],
-}
+import { COMIC_SOURCES, type TagBlacklist } from '@shared/types'
+const normalized: TagBlacklist = Object.fromEntries(
+  COMIC_SOURCES.map(s => [s, Array.isArray(raw[s]) ? raw[s] as string[] : []])
+) as TagBlacklist
```

### Step 6: 测试

#### Hook 测试 (tests/unit/hooks/useSourceOptions.test.ts)
```typescript
import { renderHook } from '@testing-library/react'
import { useSources, useSearchModes, useRankingOptions } from '@/hooks/useSourceOptions'

describe('useSourceOptions hooks', () => {
  it('useSources returns all 5 sources with labels', () => {
    const { result } = renderHook(() => useSources())
    expect(result.current).toHaveLength(5)
    expect(result.current[0]).toEqual({ value: 'hcomic', label: 'HComic' })
    expect(result.current[4]).toEqual({ value: 'copymanga', label: '拷贝漫画' })
  })

  it('useSearchModes returns all 4 modes', () => {
    const { result } = renderHook(() => useSearchModes())
    expect(result.current).toHaveLength(4)
    expect(result.current[0]).toEqual({ value: 'keyword', label: '关键词' })
  })

  it('useRankingOptions returns all 16 options', () => {
    const { result } = renderHook(() => useRankingOptions())
    expect(result.current).toHaveLength(16)
  })

  it('hooks return stable references', () => {
    const { result, rerender } = renderHook(() => useSources())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })
})
```

#### 工具函数测试
验证 `sourceLabel()`, `sourceSupportsRandom()`, `normalizeSourceKey()` 等。

## 实施步骤

1. 扩展 `shared/types.ts` — 添加 `SOURCE_META`, `SOURCE_LABELS`, `SOURCES_WITH_FAVOURITES`, `AUTH_REQUIRED_SOURCES`；简化 `TagBlacklist` 类型
2. 创建 `src/hooks/useSourceOptions.ts`
3. 重构 `src/utils/source.ts` — 添加 `sourceLabel()`, `sourceSupportsRandom()` 等
4. 简化 `src/utils/auth.ts` — 删除 `AUTH_REQUIRED_SOURCES`，改用 `sourceRequiresAuth()`
5. 更新 7 个组件文件
6. 更新 2 个 store/hook 文件
7. 创建测试文件
8. 运行全部测试验证

## 文件变更汇总

| 操作 | 文件 |
|------|------|
| 修改 | `shared/types.ts` |
| 新增 | `src/hooks/useSourceOptions.ts` |
| 新增 | `tests/unit/hooks/useSourceOptions.test.ts` |
| 重构 | `src/utils/source.ts` |
| 简化 | `src/utils/auth.ts` |
| 更新 | `src/components/SearchBar.tsx` |
| 更新 | `src/pages/FavouritesPage.tsx` |
| 更新 | `src/components/tools/DuplicateDetector.tsx` |
| 更新 | `src/components/settings/TagFilterSettings.tsx` |
| 更新 | `src/pages/SettingsPage.tsx` |
| 更新 | `src/components/ComicInfoDrawer.tsx` |
| 更新 | `src/stores/useSettingsStore.ts` |
| 更新 | `src/hooks/useInitConfig.ts` |
| 更新 | `src/pages/SearchPage.tsx` |

## 新增来源时的维护清单

重构后，添加新来源只需修改：
1. `shared/types.ts` — `COMIC_SOURCES` 数组 + `SOURCE_META` 对象
2. `src/utils/source.ts` — `normalizeSourceKey()` 的 fallback（可选）

其余所有文件自动跟随。
