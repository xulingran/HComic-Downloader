## 上下文

当前 tab 切换实现（`App.tsx:160-172`）：

```tsx
<AnimatePresence custom={direction}>        // 无 mode，即 mode="sync"
  <motion.div key={activePage} ...>          // key 变化 = 卸载旧页 + 挂载新页
    {renderPage()}                            // switch 直接返回整棵页面组件树
  </motion.div>
</AnimatePresence>
```

**现状约束**：
- 每次 `activePage` 变化都完全卸载旧页面、挂载新页面（`key` 触发）
- 7 个页面中 6 个是 `React.lazy`，首次切换含 chunk 下载 + JS 编译
- 重页面 mount 成本：SearchPage 67 hooks / FavouritesPage 41 / HistoryPage 30 / SettingsPage 29 / DownloadPage 18
- 列表页 mount 时一次性注册 N 个 `AnimatedCardWrapper`（motion.div + `layout` + `contain:layout`）到 framer-motion
- `mode="sync"` 下新旧页面短暂共存，动画状态机并行，内存峰值翻倍
- 现有缓存机制（`useSearchCacheStore` / `useFavouritesStore` / `useHistoryStore`）是独立 zustand store，组件卸载时数据不丢，切回走「同步恢复」快路径
- `requestIdleCallback` 在 Chromium renderer 原生可用，但 jsdom 测试环境缺失，需 mock
- 现有 `PageSkeleton` 内联在 `App.tsx:33-42`，是纯静态骨架无动画副作用

**利益相关者**：日常使用应用的用户（体验流畅度）、维护动画性能规范的既有约定（`docs/animation-performance.md`）。

## 目标 / 非目标

**目标：**
- 消除 tab 切换时的「小掉帧」，使 FPS 稳定在 60
- 首次切到 lazy 页面时不因 chunk 下载卡顿
- 再次切回已访问页面时不重挂、不重播 stagger
- 保持现有缓存机制、动画曲线（smoothTransition 300ms）、reduced-motion 退化路径不变
- 不引入新的外部依赖

**非目标：**
- 不改动 Sidebar 组件
- 不改动页面组件内部的动画（卡片 stagger、layout 动画保持原样）
- 不改动页面组件的 hooks/状态管理逻辑（只调整挂载时机与生命周期）
- 不引入路由库或 URL 路由
- 不做 tab 拖拽重排或 swipe 手势

## 决策

### 决策 1：两层优化采用「keep-alive 为主、prefetch 为辅」的组合架构

> **修正记录**：原设计为三层（含 deferred mount），真机验证后 deferred mount 被废弃（见决策 3'），降为两层。

**选择**：prefetch 与 keep-alive 并存，各自负责不同频次的切换成本。

```
切换频次       成本来源              负责的优化
─────────────────────────────────────────────────
首次进入某页   chunk 下载 + 冷 mount   ① idle prefetch（提前拉 chunk）
                                      （首次 mount 走 store 缓存快路径，足够轻）
再次切回该页   重挂 + stagger 重播     ② keep-alive（display 切换，零 mount）
```

**为什么是这两者**：
- prefetch 消除首次切换的 chunk 下载等待
- keep-alive 消除切回的重挂与 stagger 重播（这是最高频、最影响体验的场景）
- 首次 mount 突发在数据已就绪时（store 缓存快路径）成本可控，无需 deferred mount 兜底（见决策 3'）
- 单做任一都不够：只 prefetch 则切回仍重挂；只 keep-alive 则首次仍有 chunk 下载等待。

**替代方案考虑**：
- 改 `mode="wait"`：让 exit 完成再 enter，避免新旧页并存竞争。但总时长翻倍（300ms→600ms），有「等一下」感，且不解决 mount 突发。已否决（design archive 2026-06-19 也曾权衡此点选 sync）。
- CSS `content-visibility: auto`：让浏览器跳过离屏内容渲染。但 keep-alive 页面是 `display:none`（完全移除渲染树），比 content-visibility 更彻底；且 content-visibility 对「正在切换中」的页面无帮助。已否决。

### 决策 2：keep-alive 用「全部页面挂载 + display 切换 + 懒创建」

**选择**：维护一个「已访问页面集合」，所有已访问页面的组件实例**同时存在于 React 树中**，通过 CSS `display`（none/block）切换可见性；未访问的页面首次访问时才加入集合。

```
React 树（App renderPage 重构后）：
  <div class="page-stage">
    {visitedPages.map(page => (
      <div
        key={page}
        className={page === activePage ? 'block' : 'hidden'}   // display 切换
        aria-hidden={page !== activePage}
      >
        {renderPageContent(page)}    // 保持组件实例，切走不卸载
      </div>
    ))}
  </div>
```

**懒创建**：`visitedPages` 初始只含 `'search'`（首屏），用户访问新 tab 时才把该 tab 加入集合（`setVisited(prev => prev.includes(page) ? prev : [...prev, page])`）。未访问的 Toolbox/About 不会预创建实例、不预付成本。

**为什么不用 react-activation 等第三方 keep-alive 库**：
- 引入外部依赖（项目约定不轻易加依赖）
- 第三方库对 framer-motion 的 `AnimatePresence` + `layout` 兼容性需逐一验证
- 原生 `display` 切换是 React 最自然的 keep-alive 形式，零依赖、零魔法

**为什么 `display:none` 而非 `visibility:hidden` / `opacity:0`**：
- `visibility:hidden` 仍占布局空间（keep-alive 页面会撑开父容器高度）
- `opacity:0` 仍参与渲染（GPU 合成层不释放，多页叠加浪费内存）
- `display:none` 让浏览器完全跳过该子树的 layout 与 paint，是性能最优的隐藏方式，且释放渲染资源

### 决策 3：~~deferred mount 仅作用于「首次进入」，触发点用 onAnimationComplete~~ （已废弃，见决策 3'）

> **修正记录**：本决策在实现后验证发现 deferred mount 弊大于利，已废弃。详见决策 3'。以下保留原始设计内容作为「被否决方案」的记录。

**原选择**：keep-alive 之后，只有「首次进入某页面」（`visitedPages` 新增该页时）会真正发生 React mount。此时用 deferred mount 兜底——动画期间显示骨架，`onAnimationComplete` 触发后渲染真实页面。

**原设计时序**：

```
首次进入 DownloadPage 的时序：
  t=0     用户点击下载 tab
          → visitedPages 新增 'downloads'
          → AnimatePresence 检测到新 motion.div
          → 新页 motion.div 渲染 <PageSkeleton/>（轻量，几乎零成本）
  t=0~300ms  tab 切换动画播放（slide 8% + fade），主线程只服务动画
  t=300ms onAnimationComplete 触发
          → 该页 deferred 标志置 true
          → PageSkeleton 替换为真实 <DownloadPage/>
          → 走缓存快路径（useDownloadStore 已有数据则瞬间渲染）
```

**废弃原因（真机验证发现）**：
1. **骨架在动画期间全程可见（300ms）**，不是预期的「轻微闪现」——用户明确反馈每次首次进入页面都看到 spinner + 灰条脉冲，体验劣于直接渲染。
2. **动画完成时骨架→真实内容的硬切换**可能造成第二次视觉跳动。
3. **deferred mount 的前提已不成立**：idle prefetch 已提前加载 chunk、keep-alive 已消除切回重挂，首次进入的真实 mount 成本已被大幅压缩（数据走 store 缓存快路径），deferred 兜底的收益边际 < 它引入的视觉负担。

### 决策 3'：移除 deferred mount，首次进入直接渲染真实内容（修正后的最终决策）

**选择**：移除 deferred mount 的所有逻辑（`deferredDone` 状态、`onAnimationComplete` 触发、骨架兜底阶段）。首次进入页面时 motion.div 直接渲染真实页面内容。

```
修正后的首次进入 DownloadPage 时序：
  t=0     用户点击下载 tab
          → visitedPages 新增 'downloads'
          → motion.div 首次 mount，渲染真实 <DownloadPage/>
          → chunk 已由 idle prefetch 预热（无下载等待）
          → 数据走 useDownloadStore 缓存快路径（若有数据则瞬间渲染）
  t=0~300ms  tab 切换动画播放（slide 8% + fade）
          → 真实内容随动画淡入，无骨架闪现
```

**为什么移除是正确的**：
- prefetch + keep-alive 已覆盖 deferred mount 要解决的两类成本（chunk 下载、切回重挂），首次 mount 突发在数据已就绪时很轻
- 消除了骨架闪现这个用户可感知的体验问题
- 代码更简单（移除 `deferredDone` 状态 + `onAnimationComplete` 分支）
- 仍保留 `<Suspense fallback={<PageSkeleton/>}>` 作为 lazy chunk 加载的兜底（仅低频未预热页面首次加载时短暂出现，是 React.lazy 的标准行为，非 deferred mount）

**保留 `PageSkeleton` 组件**：仍用于 Suspense fallback（lazy 页面首次加载兜底）与未来的其他加载场景，不删除。

### 决策 4：idle prefetch 触发于 startupProgress.done，预加载高频 chunk

**选择**：监听 `startupProgress.done`（综合 Python 95% + configLoaded + fatalError 的就绪信号），在第一个 `requestIdleCallback` 窗口内顺序触发高频 lazy import。

```
高频预加载清单（按首次访问概率）：
  ComicInfoDrawer    // 点任何卡片即触发，最高频
  ComicReaderModal   // 阅读器，高频
  DownloadPage       // 侧栏常用
  FavouritesPage     // 侧栏常用
  HistoryPage        // 侧栏常用
  SettingsPage       // SearchPage 有跳转入口
  // 不预加载：ToolboxPage / MaintenancePage / AboutPage / UpdateDialog（低频）
```

**为什么只预热高频、不全部**：用户已确认。低频页面（Toolbox/Maintenance/About/UpdateDialog）切到时才加载，延迟可接受（用户已主动点击，心理预期允许短暂加载）。

**为什么触发于 done 而非 configLoaded**：`done` 是更全面的就绪信号（含 Python 后端就绪），避免在后端未就绪时就发起模块加载竞争。且 `done` 翻转那一刻 StartupScreen 正在淡出，主内容开始渲染——此时主线程负荷最低，是 idle prefetch 的最佳窗口。

**调度工具实现**：新建 `src/lib/scheduler.ts`（与 `anim.ts` 并列），封装 `requestIdleCallback`，提供降级（不支持时 fallback 到 `setTimeout(0)`）。这样 idle 调度逻辑集中，可测试。

**为什么不用 Priority Hints / `scheduler.postTask`**：Chromium 版本依赖不确定，`requestIdleCallback` 是最稳定的跨版本 API。

### 决策 5：keep-alive 切回「轻量刷新」——按页面提供刷新钩子

**选择**：keep-alive 后 mount effect 不再重复触发，为需要刷新的页面提供「切回钩子」。每个页面在 `activePage` 变为自己的 tab 且页面已挂载时，触发一次**轻量刷新**：

| 页面 | 切回刷新行为 | 理由 |
|------|------------|------|
| DownloadPage | 重拉任务列表（`loadDownloads()`） | 后台下载状态可能变化，需同步 |
| SearchPage | 不刷新（走 store 缓存） | 已有完整多页缓存 + pendingSearch effect 仍由 store 驱动 |
| FavouritesPage | 不刷新（走 store 缓存） | 多页缓存 + `onDownloadProgress` 订阅在 keep-alive 下不中断 |
| HistoryPage | 不刷新（走 store 缓存） | 历史数据变化频率低，缓存足够 |
| SettingsPage/Toolbox/Maintenance/About | 不刷新 | 静态或低频 |

**实现方式**：在 App 层暴露 `isActive` prop（页面是否为当前 activePage），页面内部用 `useEffect(() => { if (isActive) refresh() }, [isActive])` 实现切回刷新。只有 DownloadPage 需要（其余用默认行为）。

**为什么不全部刷新**：用户已确认「轻量刷新」。全量重拉会引入网络请求 + 渲染抖动，违背 keep-alive 的初衷（切回零成本）。各页面的 store 缓存 + 后台订阅已保证数据新鲜度，DownloadPage 是唯一需要主动同步的（下载是持续进行的后台任务）。

**为什么不依赖每个页面自己监听 activePage**：保持页面组件的独立性——页面不应感知「自己在 tab 系统中的可见性」。通过 prop 注入 `isActive`，把「切回刷新」的语义从 App 层明确传给页面，职责清晰。

### 决策 6：保留 `gridContainerKey` 整页替换语义

**选择**：SearchPage / FavouritesPage 内部的 `gridContainerKey`（`SearchPage.tsx:134`）机制保持不变。

**理由**：该 key 是为规避 framer-motion `layout` 在 popLayout 全量替换下的 mount 测量竞态（封面从左上角飞入）。keep-alive 是**页面级**实例复用，`gridContainerKey` 是**页面内列表容器级**重挂——两者作用层级不同，互不冲突。keep-alive 下页面不重挂，但页面内翻页/新搜索时列表容器仍正常重挂。

### 决策 7：`PageSkeleton` 提取为独立共享组件

**选择**：把当前内联在 `App.tsx:33-42` 的 `PageSkeleton` 提取到 `src/components/common/PageSkeleton.tsx`。

**理由**：作为 lazy 页面 `<Suspense fallback>` 的共享占位组件（deferred mount 已移除，不再用它兜底动画期）。它是「轻量占位」的语义实体，独立后便于复用与单独测试。提取无行为变更。

## 风险 / 权衡

| 风险 | 缓解 |
|---|---|
| **keep-alive 改变页面生命周期，5 个重页面 mount 副作用需逐一验证** | 逐页审计：全局订阅（FavouritesPage `onDownloadProgress`）在 keep-alive 下**反而更好**（不中断）；store 依赖 effect（DownloadPage `progress`）切走时仍跑但只是同步到 store（期望行为）。已在决策 5 列明每页的刷新策略，并在 tasks 中安排逐页回归测试。 |
| **`requestIdleCallback` 在 jsdom 测试环境缺失** | 在 `tests/setup.ts` 补全局 polyfill（自维护 handle map，兼容 fake timers）。项目已有 fake-timers + `Date.now()` 可测试性约定，对齐即可。 |
| **keep-alive 多页同时存在增加内存占用** | 懒创建策略保证只 keep-alive 已访问页面（非全部 8 页预创建）。桌面应用内存预算宽裕，且 `display:none` 释放渲染资源。重页面主要内存是 store 数据（本就常驻 zustand），增量主要是 DOM 节点，可控。 |
| **切回刷新钩子（`isActive` prop）增加页面组件耦合** | 只有 DownloadPage 接入刷新；其余页面无感知。通过 prop 注入而非页面自行监听全局状态，保持页面独立性。 |
| **idle prefetch 提前下载用户可能不访问的高频 chunk** | 用户已确认仅预热高频。即使预热的 DownloadPage/FavouritesPage 未被访问，成本仅是一次 chunk 下载（桌面应用不在意体积），收益是高频路径零等待。 |
| **移除 deferred mount 后首次进入仍有 mount 突发** | idle prefetch 已提前加载 chunk，数据走 store 缓存快路径，mount 成本可控。真实场景下首次切换的瞬时卡顿可接受（远好于骨架闪现的持续视觉负担）。若未来发现某页面首次进入仍明显卡顿，可针对性优化该页面自身的 mount 成本（如拆分子组件懒挂载），而非恢复全局 deferred mount。 |

## 迁移计划

本次为纯前端渲染层优化，无数据迁移、无 IPC 协议变更、无配置 schema 变更。

**部署步骤**（实现阶段，详见 tasks.md）：
1. 提取 `PageSkeleton` 为独立组件（无行为变更，先落地降风险）
2. 新建 `scheduler.ts` idle 调度工具 + `tests/setup.ts` 补 polyfill
3. 实现 idle prefetch（接入 `startupProgress.done`）
4. 重构 `App.tsx` tab 渲染为 keep-alive 结构（`visitedPages` + display 切换 + 懒创建）
5. ~~实现 deferred mount~~（**已废弃**，见决策 3'——移除后首次进入直接渲染真实内容）
6. DownloadPage 接入 `isActive` 切回刷新钩子
7. 逐页回归测试（5 个重页面副作用 + 动画 + reduced-motion）
8. 更新 `tests/unit/App.test.tsx` 适配新结构

**回滚策略**：变更集中在 `App.tsx` + 2 个新文件（`scheduler.ts`、`prefetch.ts`）+ 1 个提取组件（`PageSkeleton`）。若线上发现回归，`git revert` 单个 commit 即可恢复原 `key` 切换结构，无残留状态（keep-alive 的 `visitedPages` 是组件内 state，随卸载清除）。
