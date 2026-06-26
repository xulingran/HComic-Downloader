## 为什么

在「标题+封面」显示模式下翻页时，漫画卡片偶尔会从左上角飞入，这是错误动画。根因是 `AnimatedCardWrapper` 的 `layout` 属性配合 `AnimatePresence mode="popLayout"` 在**整页全量替换**（翻页/新搜索）时，新卡片 mount 的瞬间 framer-motion 用尚未稳定的 `getBoundingClientRect()` 做 layout 校正，把卡片从测量到的错误初始位置（常为 0,0 或上一行位置）transform 过渡到最终位置，视觉上即「从左上角飞入」。这是概率性竞态（取决于封面是否命中缓存、网格是否完成布局），仅在 cover 模式出现（detailed 模式封面固定 `w-14 h-14`、无异步高度变化，测量稳定）。

`AnimatePresence mode="popLayout"` + 子项 `layout` 的组合是为**局部增删**（删一张卡片、其余补位）设计的；翻页是全量替换，popLayout 的「挤出重排」优势用不上，反而引入 mount 测量竞态。

## 变更内容

- **修复**：在 SearchPage / FavouritesPage / DownloadPage（凡使用 `LayoutGroup + AnimatePresence mode="popLayout"` 包裹卡片列表的页面）的列表 grid 容器上加一个由「搜索上下文 + 当前页码」派生的稳定 `key`，使翻页/新搜索时整页 grid **重挂载**而非复用，从而彻底规避 layout 动画的 mount 测量竞态。
- **保留**：`AnimatedCardWrapper` 的 `layout` 属性与 `cardStyle` 切换时的位置平滑过渡行为不变（cardStyle 切换时容器 key 不变，layout 动画照常生效）。
- **保留**：列表进出场 stagger（前 20 项错峰）、reduced-motion 退化（纯 opacity）、`contain: layout` 全部不变。
- 不改动 `src/lib/anim.ts` 的 variants。

## 功能 (Capabilities)

### 新增功能
<!-- 无新增功能，本变更是对现有动画能力的 bug 修复与需求补充 -->

### 修改功能
- `ui-animation`: 补充「翻页 / 搜索结果全量替换时，卡片列表不得产生 layout 位移竞态」的需求。现有「cardStyle 切换时位置平滑过渡」与「卡片被移除时剩余卡片归位」的需求保持不变；新增「整页替换场景必须整页重挂载，禁止复用 DOM 触发 layout 测量」的约束，以消除飞入 bug。

## 影响

- **代码**：
  - `src/pages/SearchPage.tsx`：列表 grid 容器增加 `key`（派生自搜索上下文 + page）。
  - `src/pages/FavouritesPage.tsx`：同上（派生自收藏来源 + 分页/筛选上下文）。
  - `src/pages/DownloadPage.tsx`：评估其 `popLayout + layout` 是否同样存在全量替换竞态，若存在则一并修复（任务列表通常是增量增删，可能不受影响，需确认）。
  - `src/components/common/AnimatedCardWrapper.tsx`：无需改动（layout 属性保留）。
- **测试**：补充针对「翻页后卡片无 layout 位移」的回归测试（基于现有 `behavior-integration-tests` 或新增 vitest 用例，验证翻页后 grid 容器 key 变化、卡片无 transform 飞入）。
- **规范**：更新 `openspec/specs/ui-animation/spec.md` 的「ComicCard 网格 layout 动画」需求，补充全量替换场景的约束。
- **依赖/系统**：无新增依赖，纯前端 React/framer-motion 改动。
