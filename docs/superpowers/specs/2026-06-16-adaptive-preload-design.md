# 自适应预加载（Adaptive Preload）设计

- **日期**：2026-06-16
- **主题**：阅读器预加载量随翻页速度自适应调节
- **状态**：已与用户对齐，待实现

## 1. 背景与目标

当前 `usePreloadManager`（`src/hooks/usePreloadManager.ts`）使用**固定参数**预加载：`forward=8`、`backward=2`、`concurrency=3`，三者从配置 `previewPreloadForward/Backward/Concurrency` 读取。`preloadTarget` 变化时，effect 从 `target+1..target+forward` 与 `target-1..target-backward` 构造顺序队列，worker pool 并发抓取，结果存入 `imageCacheRef`。

这带来两个方向的问题：
- **翻页过快时**：固定 8 页跟不上，出现图片未加载好的白屏。
- **翻页过慢/停留时**：仍按 8 页预加载，白白消耗带宽与内存。

**目标**：让预加载量随近期翻页节奏双向自适应——快时放大预加载量并优先拉取"即将到达"的远页以保证流畅，慢时/停留时回落到基线节省资源。

**信号选择**：用近期翻页时间间隔（而非命中率反馈）作为调节信号，直观、实时、冷启动快。

## 2. 关键决策（已确认）

| 决策点 | 选择 |
|---|---|
| 核心痛点 | 双向（翻快要流畅、翻慢要省资源） |
| 调节信号 | 近期翻页间隔（中位数平滑） |
| 加载策略 | 动态放大 forward + 极快时队列远近交替 |
| 配置方式 | 保留三个手动项作为基线 + 新增「自适应」开关；持久化到 config.json |
| 停留行为 | 逐渐回落到基线（通过 stale 判定自然实现） |
| 作用范围 | 所有阅读模式（scroll/single/double） |
| 默认值 | `previewPreloadAdaptive = false`（向后兼容，逐字节不回归） |

## 3. 架构与单元划分

当前所有预加载逻辑挤在 `usePreloadManager.ts` 一个 effect 里。加入节奏跟踪、k 映射、远近交替、回落后，拆为三个边界清晰、可独立测试的单元，`usePreloadManager` 退化为编排层：

```
ComicReaderModal
   │  (传入 imageUrls, 基线 forward/backward/concurrency, adaptive 开关)
   ▼
usePreloadManager  ← 对外签名保持稳定
   ├── useFlipPace(preloadTarget)          [新 hook] 时间戳→间隔统计
   ├── computeAdaptiveParams(interval, base)[纯函数] 间隔→{forward, concurrency, alternation}
   └── buildPreloadQueue(...)              [纯函数] target→页号序列（远近交替）
```

### 边界约定

1. **对外接口不变**。`usePreloadManager(imageUrls, loadingState, scrambleId, comicId, imageQuality, forward, backward, concurrency)` 保持原签名，末尾新增一个**可选**参数 `adaptive?: { enabled: boolean }`。关闭（默认）时行为与现在逐字节一致——向后兼容底线。

2. **三个新单元各自可独立测试**：
   - `useFlipPace`：只关心时间戳→间隔统计，不感知图片。
   - `computeAdaptiveParams`：`(ms) → {forward, concurrency, alternation}` 纯映射。
   - `buildPreloadQueue`：纯数组变换，替代现有内联 `for (i=1..FORWARD) queue.push(pg)`。

3. **基线复用现有配置**。自适应开启时，用户配置的 `forward/backward/concurrency` 作为基线；`backward` **始终固定**（向后预加载不参与自适应——阅读语义是向前的），只动态调节 forward 与 concurrency。

4. **上限不新增配置项**：
   - 动态 forward 上限 = `min(base.forward × 2.5, 30)`（30 是 config 里 forward 现有合法上限）
   - 动态 concurrency 上限 = `min(base.concurrency + 2, 6)`（6 是现有上限）
   - 固定倍率，YAGNI。

## 4. 节奏跟踪 — `useFlipPace`

输入：`preloadTarget`（ComicReaderModal 在翻页/滚动时设置）。输出：

```ts
{
  effectiveInterval: number | null  // 平滑后的平均翻页间隔(ms)，无数据时 null
  isFlippingFast: boolean           // 是否进入"极快"区(触发远近交替)
}
```

### 算法

1. **采样**：ref 维护最近 N=6 次的 target 变化时间戳。仅当方向为**前进**（页号增大）时记录——回退不计入节奏（回退通常是找东西，不应拉高预加载）。

2. **有效间隔**：取时间戳相邻差分的**中位数**（非均值），对偶发手抖停顿更鲁棒。样本不足 3 个间隔时返回 `null`，调用方退回基线。中位数计算前过滤 `diff > 0`。

3. **`isFlippingFast`**：当 `effectiveInterval ≤ FAST_MS` **且** 最近一次翻页在 `STALE_MS` 内时为 true。

   | 常量 | 值 | 含义 |
   |---|---|---|
   | `FAST_MS` | 700 | 极快阈值（≤此值触发远近交替） |
   | `STALE_MS` | 2000 | 超过此时长无翻页视为"已停留" |

4. **节奏刷新触发**：轻量 `useState` 计数器 `paceTick`，记录新时间戳后 `setPaceTick(t => t+1)` 驱动重算。**时间戳数组本身不进 state**（避免重渲染与 ref 拷贝）。

5. **回落定时器**：独立 `setInterval`，节流到每 1s 检查。当 `now - lastFlipTs > STALE_MS` 时递增 `paceTick` 触发重算——`isFlippingFast` 因 stale 自然变 false，参数退回基线。这就是"逐渐回落"的实现：无需额外衰减逻辑，恢复翻页时间隔重新从短累积。

### 边界情况

- 打开新漫画/换章节时需清空时间戳数组：暴露 `reset()`，由 ComicReaderModal 在 open/close effect 中调用（与 `clearCache` 同生命周期）。
- 拖动滑块快速划过产生大量 target 变化——仍算翻页事件（快速划过正是要应对的场景），不做特殊处理。

## 5. 参数映射与队列构造

### `computeAdaptiveParams(interval, base)`

```ts
type AdaptiveParams = {
  forward: number
  concurrency: number
  alternation: boolean
}
function computeAdaptiveParams(
  interval: number | null,
  base: { forward: number; concurrency: number },
): AdaptiveParams
```

| interval | forward | concurrency | alternation |
|---|---|---|---|
| `null` 或 `≥ SLOW_MS(2000)` | `base.forward` | `base.concurrency` | false |
| `≤ FAST_MS(700)` | `min(base.forward × 2.5, 30)` | `min(base.concurrency + 2, 6)` | **true** |
| 介于两者 | 线性插值（四舍五入） | 线性插值（四舍五入） | false |

- 插值公式：`ratio = (SLOW_MS - interval) / (SLOW_MS - FAST_MS)`，`ratio ∈ [0,1]`；`forward = round(base.forward + (upperForward - base.forward) × ratio)`。
- `upperForward = min(base.forward × 2.5, 30)` 在函数入口预算一次。
- **backward 不参与映射**，始终用 `base.backward`。

### `buildPreloadQueue(target, forward, backward, total, cached, alternation)`

```ts
function buildPreloadQueue(
  target: number,
  forward: number,
  backward: number,
  total: number,
  cached: Set<number>,      // 已缓存的 0-based 索引
  alternation: boolean,
): number[]                 // 返回 1-based 页号
```

- **alternation=false**：与现状一致，`[target+1, ..., target+forward]` 后接 `[target-1, ..., target-backward]`，跳过已缓存与越界。
- **alternation=true**：远近交替。维护两个游标 `nearCursor`（从 1 递增）与 `farCursor`（从 `ceil(forward/2)` 递增），交替取，直到两游标都超过 forward。示例（forward=12）：
  ```
  [target+1, target+6, target+2, target+11, target+3, target+8, ...]
  ```
  - 近页仍尽早出现（第一个就是 `target+1`），不饿死当前页后备。
  - 远页被提前到队列前段，在翻页追上之前落袋。
  - 全部跳过已缓存/越界，返回去重后的数组。

**为何不"只拉远页"**：完全跳过近页有风险——节奏判断偶尔失准时近页没缓存会直接白屏。交替是稳妥折中，且近页本就很快抓完。

## 6. 集成与编排

### `usePreloadManager` 内部流程

```
usePreloadManager(..., forward, backward, concurrency, adaptive?)
  │
  ├─ useFlipPace(preloadTarget) → { effectiveInterval, isFlippingFast }
  │
  ├─ adaptive?.enabled ?
  │     true  → params = computeAdaptiveParams(effectiveInterval, {forward, concurrency})
  │              params.alternation = params.alternation && isFlippingFast  // 双重确认
  │     false → params = { forward, concurrency, alternation: false }
  │
  ├─ queue = buildPreloadQueue(target, params.forward, backward, total, cachedSet, params.alternation)
  │
  └─ worker pool 消费 queue（保留现有 cancelled/批量 flush 机制）
```

**关键改动点：**

1. `cachedSet`：effect 内预先生成 `new Set(cache.keys())` 一次传给 `buildPreloadQueue`，替代逐个 `cache.has(pg-1)`。语义不变。

2. worker 数量：`Math.min(params.concurrency, queue.length)` 替换原硬编码 `CONCURRENCY`。

3. 依赖数组：改为 `[preloadTarget, loadingState, imageUrls, ..., params.forward, params.concurrency, params.alternation]`——这些是 useMemo 派生值，值稳定时 effect 不重跑。

4. **effect 重跑控制（重点）**：`effectiveInterval` 几乎每次翻页都变 → `params` 每次变 → effect 重跑。重跑时 cleanup 设 `cancelled=true` 取消上一批 worker，避免同一页被并发抓两次。已缓存的页在 `buildPreloadQueue` 中被跳过，故重跑幂等。

### 外部调用点（`ComicReaderModal.tsx`）

1. 现有配置读取 effect（94-103 行）追加读 `previewPreloadAdaptive: boolean` → 新 state `adaptiveEnabled`。
2. `usePreloadManager(...)` 末尾追加 `{ enabled: adaptiveEnabled }`。
3. 不改任何渲染逻辑、不改 `setPreloadTarget` 调用方式。
4. 关闭/换章节 effect 中追加调用 `useFlipPace` 暴露的 `reset()`（与 `clearCache` 同生命周期）。

### 配置层改动（4 处，模式与现有 `previewPreload*` 完全一致）

| 文件 | 改动 |
|---|---|
| `shared/types.ts` | `Config` 增 `previewPreloadAdaptive?: boolean`；`ConfigKey`（227 行）、`DEFAULT_CONFIG`/`ConfigValueMap`（257 行）、set-config 白名单（877 行）同步 |
| `config.py` | `AppConfig` 增 `preview_preload_adaptive: bool = False`（84 行后）；`_validate_ranges` 无需改（无范围，仅类型） |
| `python/ipc/config_mixin.py` | `get_config` 返回增 `"preview_preload_adaptive": getattr(self.config, "preview_preload_adaptive", False)`（130 行后） |
| `src/components/settings/CacheSettings.tsx` | 增 checkbox：「自适应预加载（按翻页速度自动调节）」 |

### UI 位置

开关放在 `CacheSettings.tsx`，紧跟现有 forward/backward/concurrency 三个滑块。文案：
```
☐ 自适应预加载
   开启后按翻页速度自动放大预加载量；上方数值作为基线。
```
开启时三个滑块仍可见可调（它们就是基线/固定值），不灰化。

## 7. 错误处理

全部静默降级到基线，绝不让自适应逻辑本身导致白屏或崩溃：

1. **`useFlipPace` 无样本/异常**：`effectiveInterval` 返回 `null` → `computeAdaptiveParams` 退回基线 → 行为等同关闭。采样只做时间戳 diff 和中位数，不抛异常。
2. **时间戳精度**：中位数前过滤 `diff > 0`，样本不足 3 个返回 `null`。
3. **`buildPreloadQueue` 边界**：`forward=0`/`cached` 全命中/越界 → 返回空数组 → effect 的 `if (queue.length === 0) return` 自然短路。纯函数天然幂等，无需特殊处理。
4. **现有容错保留**：单页预加载失败的 `catch {}`（132 行）不动——预加载失败本就不影响阅读，ReaderPage 会自己按需加载。
5. **配置读取失败**：`getConfig().then(...)` 外层已有 `.catch(() => {})`，新读取放同一链路，失败则 `adaptiveEnabled` 保持默认 `false`。

**明确排除（避免过度设计）：**
- 不做网络质量探测（弱网时不自动调大并发——那是另一个 feature）。
- 不对单个来源（hcomic/moeimg/jm/bika）做差异化——自适应是通用的。

## 8. 测试策略

| 单元 | 类型 | 关键用例 |
|---|---|---|
| `computeAdaptiveParams` | 纯函数单测 | `null`→基线；`≥2000`→基线；`700`→上限+alternation；`1350`→插值中点；`base.forward×2.5>30` 时 clamp 到 30；concurrency clamp 到 6 |
| `buildPreloadQueue` | 纯函数单测 | 顺序模式与现状一致（黄金样本）；alternation 模式序列形态正确；跳过已缓存；越界裁剪；`forward=0`/`cached` 全命中→空数组 |
| `useFlipPace` | hook 测试 | 喂入模拟 target 序列+时间，断言 effectiveInterval 中位数；仅前进方向；stale 后 `isFlippingFast=false`；reset 清空 |
| `usePreloadManager` | hook 测试 | **关闭自适应时 fetch 调用序列与改造前完全相同**（回归黄金样本）；开启时快节奏下 fetch 次数增加、队列含远页 |
| 集成 | 现有 `ComicReaderModal.test.tsx` | 开关默认关闭→现有断言全过；新增一个开启自适应的渲染用例不崩溃 |

**优先级**：两个纯函数（`computeAdaptiveParams`、`buildPreloadQueue`）是测试核心，覆盖率要求高；hook 测试次之；集成测试保证不回归即可。

## 9. 成功标准

1. **不回归**：`previewPreloadAdaptive=false`（默认）时，`usePreloadManager` 的网络请求序列、缓存行为与改造前逐字节一致——现有所有测试通过。
2. **自适应生效**：开启后，以 ~400ms/页连续向前翻 10 页，进度条预加载区（蓝色条块）覆盖范围明显大于基线；停下阅读 2 秒后预加载范围回落。
3. **省资源**：慢速翻页（>2s/页）时，预加载范围 = 基线，不因自适应而多抓。
4. **配置持久化**：开关状态写入 `~/.hcomic_downloader/config.json`，重启应用后保持。
5. **验证流程全绿**：`pytest` + `npx tsc --noEmit` + `npm test` + `npm run lint:py` + `black --check .` + `npm run lint` 六项全过（AGENTS.md 要求）。
