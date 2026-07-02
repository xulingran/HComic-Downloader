## 为什么

当前标签推荐高亮的琥珀色值（卡片底色 `bg-amber-500/10`、tag chip `bg-amber-500/15 text-amber-600`）在深色背景下辨识度不足，用户反馈"有些浅了"。推荐态作为引导用户发现偏好漫画的视觉信号，需要更强的存在感才能起到提示作用。

## 变更内容

将推荐高亮色值整体加深一档（透明度 +5pt、色阶下沉一级），同时保持现有视觉结构（CoverCard 整圈内描边、DetailedCard 加粗左边框、tag chip 琥珀色、与选中态优先级 `selected > recommended`）完全不变：

- **CoverCard 网格视图**：底色 `/10 → /15`；内描边色阶 `amber-500 → amber-600`（RGB `245,158,11` → `217,119,6`）、不透明度 `0.8 → 0.9`
- **DetailedCard 列表视图**：左边框 `amber-400 → amber-500`；底色 `/10 → /15`
- **tag chip**（卡片 + 详情抽屉两处）：底色 `/15 → /20`、文字 `text-amber-600 → text-amber-700`、hover `/25 → /30`

**注**：`ComicInfoDrawer.tsx:544` 的 chip 样式原注释明确要求"与详情抽屉的 tag 样式保持一致"，因此抽屉处 chip 同步加深，避免两处视觉割裂。

## 功能 (Capabilities)

### 新增功能
<!-- 无新增功能 -->

### 修改功能
- `tag-recommendation-highlight`: 推荐态色值断言加深。涉及 CoverCard 内描边色阶与不透明度、CoverCard/DetailedCard 底色透明度、DetailedCard 左边框色阶、tag chip 底色与文字色阶。视觉结构（内描边 vs 左边框、选中态优先级、大小写不敏感匹配）保持不变。

## 影响

- **代码**：
  - `src/components/common/ComicCard.tsx`（第 198、259、308 行附近的三处推荐态 class）
  - `src/components/ComicInfoDrawer.tsx`（第 544 行 chip 样式，与卡片保持一致）
- **规范**：`openspec/specs/tag-recommendation-highlight/spec.md` 的色值断言需以增量方式更新（多处"约 80% 不透明度"、`bg-amber-500/10`、`bg-amber-500/15 text-amber-600`、`border-l-amber-400` 等）
- **无 API/依赖/数据流变更**：纯视觉层，`recommendedTags` 计算逻辑、IPC、配置均不动
- **测试**：现有推荐高亮相关测试（如有断言 class 名）需同步更新色值断言
