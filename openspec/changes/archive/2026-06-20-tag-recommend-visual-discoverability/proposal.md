## 为什么

标签推荐高亮功能（基于收藏夹 tag 统计、在搜索结果中高亮推荐漫画）的视觉信号太弱,导致**可发现性**不足:

- CoverCard(网格视图)的推荐态只有 `border-l-2 border-l-amber-400/70` 一条 2px 左边框,在 5 列密集网格里被封面图片和阴影淹没,用户几乎注意不到。
- 原始设计文档(`docs/superpowers/specs/2026-06-01-favourite-tag-recommendation-design.md` 第 198 行)承诺 CoverCard 推荐态要有 `bg-amber-50/5` 轻微背景色,但 `ComicCard.tsx:198` 的实现把它丢了,导致实际呈现比设计预期的还要弱。
- 此外,标签推荐功能**从未被纳入 OpenSpec spec 体系**,只有一份 design 文档,缺乏可验证的需求基线。

本次变更新增 `tag-recommendation-highlight` capability,把"推荐高亮的视觉呈现"规范化,并修复推荐信号过弱的问题。

## 变更内容

- **CoverCard 推荐态**:从单边左边框升级为整圈克制高亮——`ring-1 ring-amber-400/50`(细且半透明的环)+ 补回承诺的 `bg-amber-500/5` 微背景色。整体呈现"泛着琥珀光"而非"被硬框住",避免高命中率场景下变成"琥珀海洋"背景噪声。
- **DetailedCard 推荐态**:保留左边框(避免 list 视图行紧贴时整圈边框连成色块),但加粗为 `border-l-[3px] border-l-amber-400/80`,并补回 `bg-amber-500/5` 微背景。命中 tag 变琥珀色的现有逻辑保留不变。
- **优先级规则**:明确 `selected > recommended`——既推荐又被选中时,只显示选中态(accent ring/边框),推荐信号隐藏。避免两个视觉信号打架。
- **[BUGFIX]** 补回 `ComicCard.tsx` 中设计文档承诺但代码丢失的推荐态背景色。

不涉及任何破坏性变更:不改 props 接口、不改 store、不改后端、不改 IPC。

## 功能 (Capabilities)

### 新增功能
- `tag-recommendation-highlight`: 搜索结果中推荐漫画的高亮视觉呈现规范。覆盖 CoverCard 与 DetailedCard 两种卡片模式的推荐态样式、与选中态的优先级关系、以及 reduced-motion 退化策略。

### 修改功能
<!-- 无。标签推荐高亮此前未被任何 spec 覆盖,本次为首次建立规范。 -->

## 影响

- **代码**:仅 `src/components/common/ComicCard.tsx`——CoverCard 与 DetailedCard 两个内部组件的 className 组合及 recommended 与 selected 状态的优先级守卫。不改动 props/store/后端/IPC。
- **测试**:`tests/unit/components/common/ComicCard.test.tsx` 需补充:推荐态 className 断言、selected+recommended 叠加时的优先级断言。
- **设计文档**:本变更将标签推荐高亮的视觉行为从 `docs/superpowers/` 的非正式 design 文档提升为 OpenSpec 正式 spec,成为后续视觉演进的基线。
- **依赖**:无新增依赖。
