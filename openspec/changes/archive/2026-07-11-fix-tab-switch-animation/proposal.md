## 为什么

Tab 切换动画在首次访问某页面后失效——切到搜索页，再切到下载页（首次会有 slide+fade 动画），然后切回搜索页时**无动画**，瞬间显示。用户最初以为与 SFW 模式有关，但调查确认 SFW 仅影响封面显示，与 tab 动画无关。

根因是两个现有规范存在结构冲突，实现向其中一方妥协后静默违反了另一方：

```
ui-animation 规范：Tab 切换必须用 AnimatePresence mode="sync"，
                   新旧页同时滑入滑出（要求 mount/unmount）
          ╲
           ╲ 冲突（AnimatePresence 需卸载才触发 exit）
           ╱
page-keep-alive 规范：页面切走禁止卸载，改用 display:none（要求永不 unmount）
```

实现选择了 keep-alive（`App.tsx` 用 `visitedPages.map()` 渲染常驻 `motion.div`，`initial="initial" animate="animate"` 只在首次 mount 触发一次）。结果 `ui-animation` 规范中「每次切换都播放方向感知过渡」的需求在非首次访问时被静默违反——`exit` variant 沦为死代码，切回已访问页面时 `custom={direction}` 改变也不会重播 `initial→animate` 过渡。

## 变更内容

- **修改 tab 切换动画的驱动机制**：在保留 keep-alive（页面永不卸载）的前提下，改用 framer-motion `useAnimationControls` 在 `activePage` 变化时**手动重播**方向感知的进入/退出动画，使每次切换（含切回已访问页面）都播放 slide+fade 过渡，达到与 `AnimatePresence mode="sync"` 等效的连续推送视觉效果。
- **移除死代码**：`anim.ts` 中 tab variants 的 `exit` 分支在 keep-alive 下永远不会触发，改为由 controls 显式驱动的进出场逻辑替代。
- **保持 keep-alive 所有既定行为不变**：页面仍不卸载、滚动位置/本地状态/chunk 缓存仍保留、懒创建策略不变、`isActive` 切回刷新钩子不变。

## 功能 (Capabilities)

### 新增功能

（无）

### 修改功能

- `ui-animation`: tab 过渡需求的实现机制需与 keep-alive 架构协调——「mode 必须为 sync」需求从「必须用 AnimatePresence」改为「在 keep-alive 下通过 animation controls 同步驱动新旧页面进出场，达到等效 sync 推送效果」；并补充「切回已访问页面必须重播进入动画」的显式场景，堵住当前实现漏洞。

（`page-keep-alive` 不修改——keep-alive 行为本身不变，animation controls 重播不触发重挂载，与该规范无冲突。）

## 影响

- **`src/App.tsx`**：`handlePageChange` 周边的 `visitedPages.map` 渲染块（约 191-207 行），改用 `useAnimationControls` 驱动每个页面的进出场；需为每个存活页面维护一个 controls 实例（`Map<string, AnimationControls>` 或 ref 数组）。
- **`src/lib/anim.ts`**：`getTabPageVariants` / `getReducedTabPageVariants`（约 278-313 行）需调整——exit 分支改造为可供 controls 调用的目标状态对象，或导出独立的 `getTabPageEnterTarget(dir)` / `getTabPageExitTarget(dir)` 工具函数。
- **测试**：新增前端测试验证「切回已访问页面时进入动画被重播」（controls.start 被调用 + 方向参数正确）；回归 keep-alive 既有行为（不卸载、状态保留）。
- **规范协调**：本变更显式调和 `ui-animation`（tab 过渡）与 `page-keep-alive`（不卸载）两个既存规范的冲突点，`page-keep-alive` 无需改动。
