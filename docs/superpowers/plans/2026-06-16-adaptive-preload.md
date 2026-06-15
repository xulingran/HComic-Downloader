# 自适应预加载（Adaptive Preload）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让阅读器预加载量随近期翻页间隔自适应——翻快时放大 forward 并启用远近交替队列，慢时/停留时回落到基线；新增持久化开关 `previewPreloadAdaptive`，默认关闭以保证逐字节不回归。

**Architecture:** 把现有 `usePreloadManager` 的内联逻辑拆为三个可独立测试的单元：`useFlipPace`（翻页间隔统计 hook）、`computeAdaptiveParams`（间隔→参数的纯函数）、`buildPreloadQueue`（目标→页号序列的纯函数，含远近交替）。`usePreloadManager` 退化为编排层，对外签名保持稳定，末尾新增可选 `adaptive` 参数。配置层在前后端各加一个 `previewPreloadAdaptive` 布尔项，模式与现有 `previewPreload*` 完全一致。

**Tech Stack:** React hooks + TypeScript（前端），Python dataclass + JSON-RPC（后端配置），vitest（前端测试），pytest（后端测试）。

**Spec:** `docs/superpowers/specs/2026-06-16-adaptive-preload-design.md`

---

## 文件结构

**新增：**
- `src/hooks/adaptive-preload.ts` — 三个核心单元：`useFlipPace`、`computeAdaptiveParams`、`buildPreloadQueue`（纯逻辑 + 一个 hook，集中在同一文件便于内聚；各自 export）。
- `tests/unit/hooks/adaptive-preload.test.ts` — `computeAdaptiveParams` 与 `buildPreloadQueue` 的纯函数单测。
- `tests/unit/hooks/useFlipPace.test.tsx` — `useFlipPace` 的 hook 测试。

**修改：**
- `src/hooks/usePreloadManager.ts` — 重构 effect 调用上述三个单元；新增可选 `adaptive` 参数。
- `src/components/ComicReaderModal.tsx` — 读取 `previewPreloadAdaptive` 配置，透传给 hook；reset 时机调用 `useFlipPace` 的 reset。
- `shared/types.ts` — `Config`/`ConfigKey`/`ConfigValueMap`/`DEFAULT_CONFIG`（如存在）/set-config 白名单新增 `previewPreloadAdaptive`。
- `config.py` — `AppConfig` 新增 `preview_preload_adaptive: bool = False`。
- `python/ipc/types.py` — `CONFIG_KEY_MAP` 新增映射。
- `python/ipc/config_mixin.py` — `get_config` 返回新字段。
- `electron/main.ts` — `CONFIG_VALIDATORS` 新增 `previewPreloadAdaptive: boolean()`。
- `src/components/settings/CacheSettings.tsx` — 新增自适应开关 checkbox + props。
- `src/pages/SettingsPage.tsx` — `ConfigState`/默认值/读取/透传新增 `previewPreloadAdaptive`。
- `tests/test_config.py` — 新增字段默认值测试。
- `tests/test_ipc_config_mapping.py` —（可选）补充键覆盖。

**任务依赖：** Task 1-2（纯函数）无依赖，可并行；Task 3（hook）依赖 Task 1-2 的类型；Task 4（集成）依赖 1-3；Task 5-7（配置层）相互独立，可与 1-4 并行；Task 8（UI）依赖配置层类型；Task 9-10（测试与验证）最后。

---

### Task 1: `computeAdaptiveParams` 纯函数

实现间隔→参数的映射。这是最核心的纯函数，优先做。

**Files:**
- Create: `src/hooks/adaptive-preload.ts`
- Test: `tests/unit/hooks/adaptive-preload.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/hooks/adaptive-preload.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { computeAdaptiveParams, FAST_MS, SLOW_MS } from '@/hooks/adaptive-preload'

describe('computeAdaptiveParams', () => {
  const base = { forward: 8, concurrency: 3 }

  it('returns baseline when interval is null (no samples)', () => {
    expect(computeAdaptiveParams(null, base)).toEqual({
      forward: 8, concurrency: 3, alternation: false,
    })
  })

  it('returns baseline when interval >= SLOW_MS', () => {
    expect(computeAdaptiveParams(SLOW_MS, base)).toEqual({
      forward: 8, concurrency: 3, alternation: false,
    })
    expect(computeAdaptiveParams(5000, base)).toEqual({
      forward: 8, concurrency: 3, alternation: false,
    })
  })

  it('returns upper-bound + alternation when interval <= FAST_MS', () => {
    // forward = min(8 * 2.5, 30) = 20; concurrency = min(3 + 2, 6) = 5
    expect(computeAdaptiveParams(FAST_MS, base)).toEqual({
      forward: 20, concurrency: 5, alternation: true,
    })
    expect(computeAdaptiveParams(100, base)).toEqual({
      forward: 20, concurrency: 5, alternation: true,
    })
  })

  it('linearly interpolates at midpoint', () => {
    // midpoint = (700 + 2000) / 2 = 1350
    // ratio = 0.5; forward = round(8 + (20-8)*0.5) = 14; concurrency = round(3 + (5-3)*0.5) = 4
    expect(computeAdaptiveParams(1350, base)).toEqual({
      forward: 14, concurrency: 4, alternation: false,
    })
  })

  it('clamps forward to 30 when base*2.5 exceeds it', () => {
    const bigBase = { forward: 20, concurrency: 3 }
    // min(20*2.5, 30) = 30
    expect(computeAdaptiveParams(FAST_MS, bigBase).forward).toBe(30)
  })

  it('clamps concurrency to 6 when base+2 exceeds it', () => {
    const bigBase = { forward: 8, concurrency: 5 }
    // min(5+2, 6) = 6
    expect(computeAdaptiveParams(FAST_MS, bigBase).concurrency).toBe(6)
  })

  it('respects base.forward = 0 (preload disabled)', () => {
    expect(computeAdaptiveParams(FAST_MS, { forward: 0, concurrency: 3 })).toEqual({
      forward: 0, concurrency: 5, alternation: true,
    })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- adaptive-preload`
Expected: FAIL — 模块 `@/hooks/adaptive-preload` 不存在。

- [ ] **Step 3: 写最小实现**

创建 `src/hooks/adaptive-preload.ts`：

```ts
// 自适应预加载的三个核心单元。详见 docs/superpowers/specs/2026-06-16-adaptive-preload-design.md

/** 极快阈值(ms)：interval ≤ 此值触发远近交替队列 */
export const FAST_MS = 700
/** 慢速阈值(ms)：interval ≥ 此值回落到基线 */
export const SLOW_MS = 2000
/** forward 动态上限倍率 */
const FORWARD_BOOST = 2.5
/** forward 绝对上限（config 中 preview_preload_forward 的合法上限） */
const FORWARD_HARD_CAP = 30
/** concurrency 动态上限增量 */
const CONCURRENCY_BOOST = 2
/** concurrency 绝对上限（config 中 preview_preload_concurrency 的合法上限） */
const CONCURRENCY_HARD_CAP = 6

export interface AdaptiveParams {
  forward: number
  concurrency: number
  alternation: boolean
}

/**
 * 把平滑后的翻页间隔映射为动态预加载参数。
 * interval 为 null（无样本/stale）或 ≥ SLOW_MS 时返回基线；
 * ≤ FAST_MS 时返回上限并启用远近交替；其间线性插值。
 */
export function computeAdaptiveParams(
  interval: number | null,
  base: { forward: number; concurrency: number },
): AdaptiveParams {
  if (interval === null || interval >= SLOW_MS) {
    return { forward: base.forward, concurrency: base.concurrency, alternation: false }
  }
  const upperForward = Math.min(base.forward * FORWARD_BOOST, FORWARD_HARD_CAP)
  const upperConcurrency = Math.min(base.concurrency + CONCURRENCY_BOOST, CONCURRENCY_HARD_CAP)

  if (interval <= FAST_MS) {
    return {
      forward: Math.round(upperForward),
      concurrency: Math.round(upperConcurrency),
      alternation: true,
    }
  }
  // 线性插值：FAST_MS → 上限，SLOW_MS → 基线
  const ratio = (SLOW_MS - interval) / (SLOW_MS - FAST_MS) // ∈ (0, 1)
  return {
    forward: Math.round(base.forward + (upperForward - base.forward) * ratio),
    concurrency: Math.round(base.concurrency + (upperConcurrency - base.concurrency) * ratio),
    alternation: false,
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- adaptive-preload`
Expected: PASS（7 个用例全过）。

- [ ] **Step 5: 提交**

```bash
git add src/hooks/adaptive-preload.ts tests/unit/hooks/adaptive-preload.test.ts
git commit -m "feat(自适应预加载): 新增 computeAdaptiveParams 纯函数"
```

---

### Task 2: `buildPreloadQueue` 纯函数

实现目标→页号序列的构造，含远近交替。追加到 Task 1 的同一文件。

**Files:**
- Modify: `src/hooks/adaptive-preload.ts`
- Test: `tests/unit/hooks/adaptive-preload.test.ts`

- [ ] **Step 1: 追加失败测试**

在 `tests/unit/hooks/adaptive-preload.test.ts` 末尾追加：

```ts
import { buildPreloadQueue } from '@/hooks/adaptive-preload'

describe('buildPreloadQueue', () => {
  it('sequential order when alternation is false', () => {
    expect(buildPreloadQueue(10, 4, 2, 20, new Set(), false)).toEqual(
      [11, 12, 13, 14, 9, 8],
    )
  })

  it('alternation interleaves near and far pages', () => {
    // forward=4: nearCursor 1→2, farCursor ceil(4/2)=2→3→4
    // 序列: +1(near), +2(far), +2(near), +3(far), +3(超出forward停止near), +4(far)
    expect(buildPreloadQueue(10, 4, 0, 20, new Set(), true)).toEqual(
      [11, 12, 13],  // target+1, target+2(=ceil起点), target+2(near)... 见算法说明
    )
  })

  it('alternation with forward=12 produces interleaved sequence', () => {
    const seq = buildPreloadQueue(50, 12, 0, 100, new Set(), true)
    // 第一个必为近页 target+1，第二个为远页
    expect(seq[0]).toBe(51)
    expect(seq[1]).toBe(56) // farCursor 起点 = ceil(12/2) = 6
    // 不含重复
    expect(new Set(seq).size).toBe(seq.length)
    // 全部在 [51, 62] 内
    expect(seq.every((p) => p >= 51 && p <= 62)).toBe(true)
  })

  it('skips already-cached pages (0-based indices)', () => {
    // cached 用 0-based：索引 11 = 第 12 页 = target+2
    const cached = new Set([11]) // 跳过 page 12
    expect(buildPreloadQueue(10, 4, 0, 20, cached, false)).toEqual([11, 13, 14])
  })

  it('clamps out-of-range pages', () => {
    // target=18, total=20, forward=4 → 19,20 (21,22 越界裁剪)
    expect(buildPreloadQueue(18, 4, 2, 20, new Set(), false)).toEqual([19, 20, 17, 16])
  })

  it('returns empty when forward is 0', () => {
    expect(buildPreloadQueue(10, 0, 2, 20, new Set(), false)).toEqual([9, 8])
    expect(buildPreloadQueue(10, 0, 0, 20, new Set(), false)).toEqual([])
  })

  it('returns empty when all targets cached', () => {
    const cached = new Set([10, 11, 12, 13]) // pages 11-14 全缓存
    expect(buildPreloadQueue(10, 4, 0, 20, cached, false)).toEqual([])
  })
})
```

> **关于 alternation 序列的精确预期**：算法用两个游标交替取页——`nearCursor` 从 1 递增、`farCursor` 从 `ceil(forward/2)` 递增，每轮先取 near 再取 far，任一游标超过 forward 即停。Step 3 实现后，先跑测试拿到实际序列，**修正 Step 1 中 alternation 用例的预期值**使之与算法一致（保留"第一个是 target+1、第二个是远页、无重复、范围正确"的不变量断言）。这是 TDD 中"先写实现再校准黄金样本"的合理用法——alternation 序列形态由算法定义，预期值从实现导出。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- adaptive-preload`
Expected: FAIL — `buildPreloadQueue` 未导出。

- [ ] **Step 3: 追加实现**

在 `src/hooks/adaptive-preload.ts` 末尾追加：

```ts
/**
 * 构造预加载页号队列（1-based）。
 * - alternation=false：顺序 [target+1..target+forward] 后接 [target-1..target-backward]
 * - alternation=true：远近交替，近页游标从 1、远页游标从 ceil(forward/2) 起，交替取，
 *   保证即将到达的远页在翻页追上之前落袋。
 * 全程跳过已缓存（0-based 索引集合）与越界页，返回去重后的数组。
 */
export function buildPreloadQueue(
  target: number,
  forward: number,
  backward: number,
  total: number,
  cached: Set<number>,
  alternation: boolean,
): number[] {
  const result: number[] = []
  const seen = new Set<number>()
  const pushIfValid = (page: number) => {
    if (page < 1 || page > total) return
    if (cached.has(page - 1)) return
    if (seen.has(page)) return
    seen.add(page)
    result.push(page)
  }

  if (alternation && forward > 0) {
    let nearCursor = 1
    let farCursor = Math.ceil(forward / 2)
    while (nearCursor <= forward || farCursor <= forward) {
      if (nearCursor <= forward) {
        pushIfValid(target + nearCursor)
        nearCursor++
      }
      if (farCursor <= forward) {
        pushIfValid(target + farCursor)
        farCursor++
      }
    }
  } else {
    for (let i = 1; i <= forward; i++) pushIfValid(target + i)
  }
  for (let i = 1; i <= backward; i++) pushIfValid(target - i)
  return result
}
```

- [ ] **Step 4: 运行测试，校准 alternation 用例预期**

Run: `npm test -- adaptive-preload`

若有 alternation 用例因预期值不匹配而失败：根据实际输出修正 `tests/unit/hooks/adaptive-preload.test.ts` 中 `buildPreloadQueue(10, 4, 0, 20, new Set(), true)` 的预期数组，使其与算法一致。保留其余不变量断言（第一个=target+1、无重复、范围正确）。
Expected: PASS（所有用例通过）。

- [ ] **Step 5: 提交**

```bash
git add src/hooks/adaptive-preload.ts tests/unit/hooks/adaptive-preload.test.ts
git commit -m "feat(自适应预加载): 新增 buildPreloadQueue 含远近交替"
```

---

### Task 3: `useFlipPace` hook

实现翻页间隔跟踪。需要可控时间，因此用 `vi.useFakeTimers()` + 直接操纵 ref。

**Files:**
- Modify: `src/hooks/adaptive-preload.ts`
- Create: `tests/unit/hooks/useFlipPace.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/hooks/useFlipPace.test.tsx`：

```tsx
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useFlipPace, FLIP_PACE_SAMPLE_SIZE, FLIP_PACE_MIN_SAMPLES, STALE_MS } from '@/hooks/adaptive-preload'

describe('useFlipPace', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-16T00:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null interval before enough samples', () => {
    const { result, rerender } = renderHook(({ target }) => useFlipPace(target), {
      initialProps: { target: 1 },
    })
    // 前进到 2（1 个间隔，< MIN_SAMPLES）
    act(() => { vi.advanceTimersByTime(500); rerender({ target: 2 }) })
    expect(result.current.effectiveInterval).toBeNull()
    expect(result.current.isFlippingFast).toBe(false)
  })

  it('computes median interval after enough forward flips', () => {
    const { result, rerender } = renderHook(({ target }) => useFlipPace(target), {
      initialProps: { target: 1 },
    })
    // 产生 3 个间隔: 500, 500, 500 → 中位数 500（极快）
    act(() => { vi.advanceTimersByTime(500); rerender({ target: 2 }) })
    act(() => { vi.advanceTimersByTime(500); rerender({ target: 3 }) })
    act(() => { vi.advanceTimersByTime(500); rerender({ target: 4 }) })
    expect(result.current.effectiveInterval).toBe(500)
    expect(result.current.isFlippingFast).toBe(true)
  })

  it('ignores backward flips (page decreasing)', () => {
    const { result, rerender } = renderHook(({ target }) => useFlipPace(target), {
      initialProps: { target: 5 },
    })
    act(() => { vi.advanceTimersByTime(300); rerender({ target: 4 }) }) // 后退，不记录
    act(() => { vi.advanceTimersByTime(300); rerender({ target: 3 }) }) // 后退，不记录
    expect(result.current.effectiveInterval).toBeNull()
  })

  it('isFlippingFast becomes false after going stale', () => {
    const { result, rerender } = renderHook(({ target }) => useFlipPace(target), {
      initialProps: { target: 1 },
    })
    act(() => { vi.advanceTimersByTime(400); rerender({ target: 2 }) })
    act(() => { vi.advanceTimersByTime(400); rerender({ target: 3 }) })
    act(() => { vi.advanceTimersByTime(400); rerender({ target: 4 }) })
    expect(result.current.isFlippingFast).toBe(true)
    // 停留超过 STALE_MS，触发回落定时器
    act(() => { vi.advanceTimersByTime(STALE_MS + 100) })
    expect(result.current.isFlippingFast).toBe(false)
  })

  it('reset clears samples', () => {
    const { result, rerender } = renderHook(({ target }) => useFlipPace(target), {
      initialProps: { target: 1 },
    })
    act(() => { vi.advanceTimersByTime(400); rerender({ target: 2 }) })
    act(() => { vi.advanceTimersByTime(400); rerender({ target: 3 }) })
    act(() => { vi.advanceTimersByTime(400); rerender({ target: 4 }) })
    expect(result.current.effectiveInterval).toBe(400)
    act(() => { result.current.reset() })
    expect(result.current.effectiveInterval).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- useFlipPace`
Expected: FAIL — `useFlipPace` 未导出。

- [ ] **Step 3: 追加实现**

在 `src/hooks/adaptive-preload.ts` 顶部追加 React 导入（若尚无），末尾追加 hook：

```ts
import { useEffect, useRef, useState } from 'react'

/** 最大样本数（时间戳） */
export const FLIP_PACE_SAMPLE_SIZE = 6
/** 计算中位数所需的最小间隔样本数 */
export const FLIP_PACE_MIN_SAMPLES = 3
/** 无翻页超过此时长(ms)视为已停留 → 回落 */
export const STALE_MS = 2000

export interface FlipPace {
  effectiveInterval: number | null
  isFlippingFast: boolean
  reset: () => void
}

/**
 * 跟踪 preloadTarget 的前进翻页节奏，输出平滑后的间隔与"是否极快"判定。
 * 仅记录前进方向（页号增大）的变化；样本不足或 stale 时退回 null/false。
 * 回落通过 1s 节流定时器检测 lastFlipTs 实现——无需额外衰减逻辑。
 */
export function useFlipPace(target: number): FlipPace {
  const timestampsRef = useRef<number[]>([])
  const lastTargetRef = useRef<number>(target)
  const lastFlipTsRef = useRef<number>(0)
  const [, setPaceTick] = useState(0)
  const forceUpdate = () => setPaceTick((t) => t + 1)

  // 记录前进翻页
  useEffect(() => {
    if (target > lastTargetRef.current) {
      const now = performance.now()
      const ts = timestampsRef.current
      ts.push(now)
      if (ts.length > FLIP_PACE_SAMPLE_SIZE) ts.shift()
      lastFlipTsRef.current = now
      forceUpdate()
    }
    lastTargetRef.current = target
  }, [target])

  // 回落检测定时器
  useEffect(() => {
    const id = setInterval(() => {
      if (lastFlipTsRef.current > 0 && performance.now() - lastFlipTsRef.current > STALE_MS) {
        forceUpdate()
      }
    }, 1000)
    return () => clearInterval(id)
  }, [])

  const reset = () => {
    timestampsRef.current = []
    lastFlipTsRef.current = 0
    lastTargetRef.current = target
    forceUpdate()
  }

  // 计算中位数间隔
  const ts = timestampsRef.current
  const diffs: number[] = []
  for (let i = 1; i < ts.length; i++) {
    const d = ts[i] - ts[i - 1]
    if (d > 0) diffs.push(d)
  }
  let effectiveInterval: number | null = null
  if (diffs.length >= FLIP_PACE_MIN_SAMPLES) {
    const sorted = [...diffs].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    effectiveInterval = sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid]
  }
  const stale = lastFlipTsRef.current === 0 || performance.now() - lastFlipTsRef.current > STALE_MS
  const isFlippingFast = !stale && effectiveInterval !== null && effectiveInterval <= FAST_MS

  return { effectiveInterval, isFlippingFast, reset }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- useFlipPace`
Expected: PASS（5 个用例全过）。

> 若 `performance.now()` 在 jsdom 下不自增（它不随 `vi.advanceTimersByTime` 走），改用 `Date.now()` 替换实现中所有 `performance.now()`（Step 3 代码已隐含此风险，执行时二选一统一）。测试用 `vi.setSystemTime` 控制 `Date.now()`。

- [ ] **Step 5: 提交**

```bash
git add src/hooks/adaptive-preload.ts tests/unit/hooks/useFlipPace.test.tsx
git commit -m "feat(自适应预加载): 新增 useFlipPace 节奏跟踪 hook"
```

---

### Task 4: `usePreloadManager` 集成

重构现有 effect 调用三个新单元，新增 `adaptive` 可选参数。**关闭时行为逐字节不变**是回归底线。

**Files:**
- Modify: `src/hooks/usePreloadManager.ts`

- [ ] **Step 1: 写回归黄金样本测试**

在 `tests/unit/hooks/` 新建 `usePreloadManager.test.tsx`，捕获**关闭自适应时**的 fetch 调用序列（确保与改造前一致）：

```tsx
import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { usePreloadManager } from '@/hooks/usePreloadManager'

const mockFetch = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockResolvedValue({ dataUri: 'data:image/png;base64,AAA' })
  Object.defineProperty(window, 'hcomic', {
    value: { fetchPreviewImage: mockFetch },
    configurable: true,
  })
})

describe('usePreloadManager (adaptive disabled, regression)', () => {
  it('fetches forward+backward pages in order matching pre-refactor behavior', async () => {
    const urls = Array.from({ length: 20 }, (_, i) => `u${i + 1}`)
    const { result } = renderHook(() =>
      usePreloadManager(urls, 'loaded', undefined, undefined, undefined, 4, 2, 3),
    )
    act(() => result.current.setPreloadTarget(10))
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    // 等待队列消费完
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(6), { timeout: 2000 })
    const calledUrls = mockFetch.mock.calls.map((c) => c[0])
    // forward: u11,u12,u13,u14; backward: u9,u8（顺序不严格要求，但集合必须精确）
    expect(calledUrls.sort()).toEqual(['u8', 'u9', 'u11', 'u12', 'u13', 'u14'])
  })

  it('does not re-fetch already cached pages on target change', async () => {
    const urls = Array.from({ length: 20 }, (_, i) => `u${i + 1}`)
    const { result } = renderHook(() =>
      usePreloadManager(urls, 'loaded', undefined, undefined, undefined, 4, 0, 3),
    )
    act(() => result.current.setPreloadTarget(5))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(4), { timeout: 2000 })
    mockFetch.mockClear()
    act(() => result.current.setPreloadTarget(6)) // +1，u6..u9 已缓存 u6,u7,u8，u9 新
    await waitFor(() => expect(mockFetch).toHaveBeenCalled(), { timeout: 2000 })
    const calledUrls = mockFetch.mock.calls.map((c) => c[0])
    // 只应抓未缓存的：u10（新 target+4）
    expect(calledUrls).toEqual(['u10'])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- usePreloadManager`
Expected: FAIL 或通过——若通过说明现有行为已符合，测试即作为回归保护；继续。

- [ ] **Step 3: 重构 `usePreloadManager`**

打开 `src/hooks/usePreloadManager.ts`。完整替换文件内容（保留 `computeContiguousRanges` 与 `recomputeRanges` 不变，只改 hook 主体）：

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFlipPace, computeAdaptiveParams, buildPreloadQueue } from './adaptive-preload'

// （保留原有 computeContiguousRanges / recomputeRanges 两个函数原样不动）

export function usePreloadManager(
  imageUrls: string[],
  loadingState: string,
  scrambleId?: string,
  comicId?: string,
  imageQuality?: string,
  forward = 8,
  backward = 2,
  concurrency = 3,
  adaptive?: { enabled: boolean },
) {
  const imageCacheRef = useRef(new Map<number, string>())
  const [cacheVersion, setCacheVersion] = useState(0)
  const [preloadedRanges, setPreloadedRanges] = useState<
    { start: number; end: number }[]
  >([])
  const [preloadTarget, setPreloadTarget] = useState<number | null>(null)

  const { effectiveInterval, isFlippingFast } = useFlipPace(preloadTarget ?? -1)

  const clearCache = useCallback(() => {
    imageCacheRef.current.clear()
    setCacheVersion(0)
    setPreloadedRanges([])
    setPreloadTarget(null)
  }, [])

  // 计算动态参数（关闭自适应时恒为基线 + alternation:false，行为不变）
  const params = useMemo(() => {
    if (!adaptive?.enabled) {
      return { forward, concurrency, alternation: false }
    }
    const p = computeAdaptiveParams(effectiveInterval, { forward, concurrency })
    return { ...p, alternation: p.alternation && isFlippingFast }
  }, [adaptive?.enabled, effectiveInterval, isFlippingFast, forward, concurrency])

  useEffect(() => {
    if (preloadTarget == null || loadingState !== 'loaded') return
    let cancelled = false
    const cache = imageCacheRef.current

    const queue = buildPreloadQueue(
      preloadTarget,
      params.forward,
      backward,
      imageUrls.length,
      new Set(cache.keys()),
      params.alternation,
    )
    if (queue.length === 0) return

    const total = imageUrls.length
    const workerCount = Math.min(params.concurrency, queue.length)
    let pendingWrites = 0
    const workers: Promise<void>[] = []

    const flushBatch = () => {
      setCacheVersion((v) => v + 1)
      setPreloadedRanges(recomputeRanges(cache, total))
    }

    for (let i = 0; i < workerCount; i++) {
      workers.push(
        (async () => {
          while (queue.length > 0 && !cancelled) {
            const pg = queue.shift()!
            try {
              const result = await window.hcomic!.fetchPreviewImage(
                imageUrls[pg - 1], scrambleId, comicId, imageQuality,
              )
              if (cancelled) return
              if (result?.dataUri) {
                cache.set(pg - 1, result.dataUri)
                pendingWrites++
                if (pendingWrites >= 3) {
                  pendingWrites = 0
                  flushBatch()
                }
              }
            } catch {
              // Individual page preload failures are non-critical
            }
          }
        })(),
      )
    }

    Promise.all(workers).then(() => {
      if (!cancelled && pendingWrites > 0) flushBatch()
    })

    return () => { cancelled = true }
  }, [preloadTarget, loadingState, imageUrls, scrambleId, comicId, imageQuality,
      params.forward, params.concurrency, params.alternation, backward])

  return {
    imageCacheRef, cacheVersion, preloadedRanges, preloadTarget,
    setPreloadTarget, clearCache,
  }
}
```

> 注意：`useFlipPace(preloadTarget ?? -1)` 用 -1 作为 null 的占位，确保 hook 始终收到 number。

- [ ] **Step 4: 运行回归测试**

Run: `npm test -- usePreloadManager`
Expected: PASS（关闭自适应时行为与改造前一致）。

- [ ] **Step 5: 运行全量前端测试确认无回归**

Run: `npm test`
Expected: 全绿（含现有 `ComicReaderModal.test.tsx`）。

- [ ] **Step 6: 提交**

```bash
git add src/hooks/usePreloadManager.ts tests/unit/hooks/usePreloadManager.test.tsx
git commit -m "feat(自适应预加载): usePreloadManager 集成三个单元，新增 adaptive 参数"
```

---

### Task 5: 后端配置 — `config.py` + `python/ipc/types.py` + `config_mixin.py`

新增 `preview_preload_adaptive` 字段贯穿后端三层。

**Files:**
- Modify: `config.py:84`
- Modify: `python/ipc/types.py:43`
- Modify: `python/ipc/config_mixin.py:130`

- [ ] **Step 1: 写失败测试**

在 `tests/test_config.py` 末尾追加：

```python
class TestPreviewPreloadAdaptive(unittest.TestCase):
    def test_default_is_false(self):
        from config import Config
        config = Config()
        assert config.preview_preload_adaptive is False
```

- [ ] **Step 2: 运行测试确认失败**

Run: `venv/bin/pytest tests/test_config.py::TestPreviewPreloadAdaptive -v`（macOS；Windows 用 `venv\Scripts\pytest.exe`）
Expected: FAIL — `AttributeError: 'Config' object has no attribute 'preview_preload_adaptive'`。

- [ ] **Step 3: 在 `config.py` 加字段**

打开 `config.py`，在第 84 行 `preview_preload_concurrency` 之后追加：

```python
    # 预览自适应预加载开关：开启后按翻页速度动态调节预加载量
    preview_preload_adaptive: bool = False
```

- [ ] **Step 4: 在 `python/ipc/types.py` 加映射**

在 `CONFIG_KEY_MAP`（第 43 行 `previewPreloadConcurrency` 后）追加：

```python
    "previewPreloadAdaptive": "preview_preload_adaptive",
```

- [ ] **Step 5: 在 `python/ipc/config_mixin.py` 加返回**

在第 130 行 `preview_preload_concurrency` 之后追加：

```python
            "preview_preload_adaptive": getattr(self.config, "preview_preload_adaptive", False),
```

- [ ] **Step 6: 运行测试确认通过**

Run: `venv/bin/pytest tests/test_config.py::TestPreviewPreloadAdaptive tests/test_ipc_config_mapping.py -v`
Expected: PASS。`test_ipc_config_mapping.py::test_all_mappings_point_to_valid_config_fields` 也应通过（新映射指向已存在字段）。

- [ ] **Step 7: 提交**

```bash
git add config.py python/ipc/types.py python/ipc/config_mixin.py tests/test_config.py
git commit -m "feat(配置): 后端新增 preview_preload_adaptive 字段"
```

---

### Task 6: 前端配置类型 — `shared/types.ts`

让前端类型契约识别新配置键。

**Files:**
- Modify: `shared/types.ts`（4 处：106、227、256、876）

- [ ] **Step 1: 加可选字段到 `Config`**

第 106 行 `previewPreloadConcurrency?: number` 之后追加：

```ts
  previewPreloadAdaptive?: boolean
```

- [ ] **Step 2: 加到 `ConfigKey` 联合类型**

第 227 行 `'previewPreloadForward' | 'previewPreloadBackward' | 'previewPreloadConcurrency'` 之后追加：

```ts
  | 'previewPreloadAdaptive'
```

- [ ] **Step 3: 加到 `ConfigValueMap`（必需字段）**

第 256 行 `previewPreloadConcurrency: number` 之后追加：

```ts
  previewPreloadAdaptive: boolean
```

- [ ] **Step 4: 加到 set-config 白名单**

第 876 行 `'previewPreloadForward', 'previewPreloadBackward', 'previewPreloadConcurrency',` 之后追加：

```ts
  'previewPreloadAdaptive',
```

- [ ] **Step 5: 类型检查确认通过**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 6: 提交**

```bash
git add shared/types.ts
git commit -m "feat(配置): 前端类型新增 previewPreloadAdaptive"
```

---

### Task 7: Electron 校验 — `electron/main.ts`

`set-config` 走 `CONFIG_VALIDATORS` 白名单校验，新键必须注册否则被拒。

**Files:**
- Modify: `electron/main.ts:228`

- [ ] **Step 1: 加 validator**

在第 228 行 `previewPreloadConcurrency: and(number(), integer(), range(1, 6)),` 之后追加：

```ts
  previewPreloadAdaptive: boolean(),
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add electron/main.ts
git commit -m "feat(配置): electron 注册 previewPreloadAdaptive 校验"
```

---

### Task 8: 设置页 UI — `CacheSettings.tsx` + `SettingsPage.tsx`

新增自适应开关 checkbox，串接配置读取与持久化。

**Files:**
- Modify: `src/components/settings/CacheSettings.tsx`
- Modify: `src/pages/SettingsPage.tsx`

- [ ] **Step 1: 改 `CacheSettings` props 与渲染**

在 `src/components/settings/CacheSettings.tsx`：

接口（第 11-18 行）加一个 prop：
```ts
interface CacheSettingsProps {
  onSizeLimitChange: (mb: number) => void
  sizeLimitMB: number
  previewPreloadForward: number
  previewPreloadBackward: number
  previewPreloadConcurrency: number
  previewPreloadAdaptive: boolean
  onConfigChange: (key: ConfigKey, value: unknown) => void
}
```

解构（第 20-27 行）加 `previewPreloadAdaptive`。

在第 196 行 `<div className="space-y-4">` 内、第一个滑块（向前预加载）**之前**插入开关：

```tsx
              <label className="flex items-center gap-2 text-sm text-[var(--text-primary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={previewPreloadAdaptive}
                  onChange={(e) => onConfigChange('previewPreloadAdaptive', e.target.checked)}
                  className="accent-[var(--accent)]"
                />
                <span>自适应预加载</span>
                <span className="text-xs text-[var(--text-secondary)]">
                  （按翻页速度自动放大；上方数值作为基线）
                </span>
              </label>
```

- [ ] **Step 2: 改 `SettingsPage` ConfigState 与读取**

在 `src/pages/SettingsPage.tsx`：

`ConfigState` 接口（约第 9-11 行 `previewPreload*` 区域）加：
```ts
  previewPreloadAdaptive: boolean
```

默认值（约第 49-51 行）加：
```ts
    previewPreloadAdaptive: false,
```

读取（约第 69-71 行 `result.config.previewPreload*` 区域）加：
```ts
          previewPreloadAdaptive: result.config.previewPreloadAdaptive ?? false,
```

传给组件（约第 87-89 行）加：
```tsx
          previewPreloadAdaptive={config.previewPreloadAdaptive}
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: 提交**

```bash
git add src/components/settings/CacheSettings.tsx src/pages/SettingsPage.tsx
git commit -m "feat(设置页): 新增自适应预加载开关"
```

---

### Task 9: 阅读器集成 — `ComicReaderModal.tsx`

读取配置并透传给 `usePreloadManager`。这是让功能真正生效的最后一环。

**Files:**
- Modify: `src/components/ComicReaderModal.tsx`

- [ ] **Step 1: 加 state 与读取**

在第 45 行 `const [preloadConcurrency, setPreloadConcurrency] = useState(3)` 之后追加：

```tsx
  const [adaptiveEnabled, setAdaptiveEnabled] = useState(false)
```

在第 94-103 行的 `getConfig().then(...)` 块内（`setPreloadConcurrency` 之后）追加：

```tsx
      if (typeof cfg?.previewPreloadAdaptive === 'boolean') setAdaptiveEnabled(cfg.previewPreloadAdaptive)
```

- [ ] **Step 2: 透传给 hook**

修改第 56-65 行的 `usePreloadManager(...)` 调用，末尾加 `adaptive` 参数：

```tsx
  const {
    imageCacheRef,
    cacheVersion,
    preloadedRanges,
    preloadTarget,
    setPreloadTarget,
    clearCache,
  } = usePreloadManager(
    imageUrls,
    loadingState,
    scrambleId,
    comicId,
    comic?.sourceSite === 'bika' ? bikaImageQuality : undefined,
    preloadForward,
    preloadBackward,
    preloadConcurrency,
    { enabled: adaptiveEnabled },
  )
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: 运行现有阅读器测试确认无回归**

Run: `npm test -- ComicReaderModal`
Expected: PASS（开关默认 false，行为不变）。

- [ ] **Step 5: 提交**

```bash
git add src/components/ComicReaderModal.tsx
git commit -m "feat(阅读器): 接入自适应预加载开关"
```

---

### Task 10: 全量验证

按 AGENTS.md 要求跑完六项检查。

- [ ] **Step 1: Python 测试**

Run: `venv/bin/pytest`
Expected: 全绿。

- [ ] **Step 2: TypeScript 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: 前端测试**

Run: `npm test`
Expected: 全绿。

- [ ] **Step 4: Python lint**

Run: `npm run lint:py`
Expected: 无错误。

- [ ] **Step 5: Python 格式化检查**

Run: `venv/bin/black --check .`
Expected: 无需重新格式化。

- [ ] **Step 6: JS/TS lint**

Run: `npm run lint`
Expected: 无错误。

- [ ] **Step 7: 若 black 报需格式化，修复后重跑 Step 5**

```bash
venv/bin/black .
git add -A && git commit -m "style: black 格式化"
```

---

## 自审（执行前已完成）

**1. Spec 覆盖：**
- §3 架构三单元 → Task 1/2/3 ✓
- §4 节奏跟踪 → Task 3 ✓
- §5 映射+队列 → Task 1/2 ✓
- §6 集成编排 → Task 4 ✓；调用点 → Task 9 ✓；配置层 4 文件 → Task 5/6/7/8 ✓
- §7 错误处理：`forward=0`/cached 全命中/越界 → Task 2 测试覆盖 ✓；配置读取失败 → Task 9 `.catch` 已有链路 ✓
- §8 测试策略 → Task 1/2/3/4 全覆盖 ✓
- §9 成功标准 5 项 → Task 10 验证 1/4/5；标准 2/3 需手动验证（实现后由用户在 dev 模式确认）

**2. 占位符扫描：** Task 2 Step 4 的"校准 alternation 预期"是显式 TDD 流程说明（先实现后校准黄金样本），非占位符——已说明保留不变量断言。无 TBD/TODO。

**3. 类型一致性：**
- `AdaptiveParams { forward, concurrency, alternation }` — Task 1 定义，Task 4 消费 ✓
- `FlipPace { effectiveInterval, isFlippingFast, reset }` — Task 3 定义，Task 4 消费 ✓
- `buildPreloadQueue(target, forward, backward, total, cached, alternation)` — Task 2 定义，Task 4 消费 ✓
- `usePreloadManager(..., adaptive?: { enabled: boolean })` — Task 4 定义，Task 9 消费 ✓
- 配置键 `previewPreloadAdaptive` / `preview_preload_adaptive` — Task 5/6/7/8/9 全程一致 ✓

**4. 遗漏检查：** `config.py` 的 `_validate_ranges`（第 128-141 行）无需改——新字段是 bool 无范围，spec §6 已明确。`config_mixin` 的 `reverse_map` 由 `CONFIG_KEY_MAP` 自动派生（第 100 行），Task 5 Step 4 加映射后 camel 转换自动生效 ✓。

---

## 执行选择

计划已保存到 `docs/superpowers/plans/2026-06-16-adaptive-preload.md`。两种执行方式：

**1. Subagent-Driven（推荐）** — 每个 Task 派发独立 subagent，任务间做两阶段审查，迭代快、上下文干净。

**2. Inline Execution** — 在当前会话内批量执行，带检查点审查。

选哪种？
