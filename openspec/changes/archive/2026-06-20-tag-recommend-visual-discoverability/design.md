## 上下文

标签推荐高亮功能已上线,但视觉呈现存在两个问题:

1. **可发现性不足**:CoverCard(网格视图)的推荐态只有 `border-l-2 border-l-amber-400/70` 一条 2px 左边框,在 5 列密集网格里被封面图片和阴影淹没。
2. **设计承诺未兑现**:原始 design 文档(`docs/superpowers/specs/2026-06-01-favourite-tag-recommendation-design.md` 第 198 行)承诺 CoverCard 推荐态要有 `bg-amber-50/5` 轻微背景色,但 `ComicCard.tsx:198` 的实现把它丢了,实际呈现比设计预期更弱。

当前 `ComicCard.tsx` 中两处推荐态样式:

- CoverCard(L198):`${isRecommended ? 'border-l-2 border-l-amber-400/70' : ''}`
- DetailedCard(L259):`${isRecommended && !selected ? 'border-l-2 border-l-amber-400/70' : ''}`

DetailedCard 已有 `!selected` 优先级守卫,但 CoverCard 没有(因为 CoverCard 的 selected 用 `ring-2`,recommended 用 `border-l-2`,不同 CSS 属性,天然不冲突)。

约束:
- 不改 props 接口、store、后端、IPC
- 遵循项目 `ui-animation` spec 中的 transition 精确属性规则(避免 `transition-all`)
- CoverCard 封面用 `aspect-[6/7]` 定比,不能被边框挤压导致重新布局

## 目标 / 非目标

**目标:**
- 提升 CoverCard 推荐态的可发现性:从单边线升级为整圈克制高亮
- 补回设计文档承诺但代码丢失的推荐态背景色
- 明确 `selected > recommended` 的优先级规则,并让 CoverCard 也遵守(改用 ring 后会和 selected 冲突)
- DetailedCard 推荐态信号略微增强(加粗左边框 + 补背景),但不破坏 list 视图的行间呼吸

**非目标:**
- 不引入星标 icon、命中数 badge、ribbon 丝带等新视觉元素(那是其他探索方向)
- 不改 DetailedCard 命中 tag 变琥珀色的现有逻辑(已工作良好)
- 不改设置页 `FavouriteTagSettings` 的任何内容
- 不改 SearchPage 的推荐计算逻辑
- 不做推荐强度分级(命中 1 tag vs 8 tag 视觉相同)

## 决策

### 决策 1:CoverCard 用整圈高亮而非单边边框

**选择**:整圈琥珀内描边 + 微背景(`bg-amber-500/10 shadow-[inset_0_0_0_2px_rgba(245,158,11,0.8)]`)

**理由**:
- 单边边框(原始 `border-l-2`)在 5 列密集网格里可发现性不足,需升级为整圈高亮
- 用 `border-2` 实现整圈会吃掉内部像素,挤压 `aspect-[6/7]` 封面,否决
- 最初选 `ring-2 ring-amber-400/80`(外环),视觉强度合适,但见决策 5 发现溢出问题后改为内描边

**替代方案**:
- `border-2`:挤压封面布局,否决
- 仅外发光 `shadow-[0_0_8px_rgba(245,158,11,0.4)]`:偏装饰、强度不足,否决

### 决策 2:推荐态用微背景配合高亮,避免"琥珀海洋"

**选择**:`bg-amber-500/10`(微背景)+ 内描边(强信号)

**理由**:
- 当用户收藏的 tag 较泛(如"校园""日常""恋爱"),搜索结果一页可能大半命中推荐。如果信号过强(纯实色满描边 + 深背景),推荐会变成背景噪声,失去信号意义
- `/10` 背景是原始设计文档承诺的微背景(第 198 行),本次顺带补回
- 强度经过手动验证调优:初版 `bg-amber-500/5` 太弱,最终 `bg-amber-500/10` + 2px/80% 内描边达到"明显但不喧宾夺主"

**替代方案**:
- `bg-amber-500/15` 或更深:高命中率下变琥珀海洋,否决
- 只加描边不加背景:深色模式下描边外区域缺乏整体感,否决

### 决策 3:DetailedCard 保留左边框,不做整圈

**选择**:`border-l-4 border-l-amber-400 bg-amber-500/10`(实色 4px 边框 + 加深背景)

**理由**:
- list 视图行紧贴(无 gap,只有 `border-b` 分隔),整圈边框会让连续推荐的行连成"琥珀色块",割裂感强
- 加粗到 4px 实色(从原 2px/70%):可发现性的必要提升,手动验证后确定 4px 实色既明显又不破坏行间呼吸
- DetailedCard 的 `border-l` 是元素 border-box 内嵌,天然不溢出视口(与 CoverCard 不同),无需 inset 处理

**替代方案**:
- 也做整圈:行间连缀成色块,否决
- 保持 2px 不变:可发现性提升不足,否决

### 决策 4:`selected > recommended` 优先级,CoverCard 必须显式守卫

**选择**:
- CoverCard 推荐态只在 `!selected` 时渲染:`${isRecommended && !selected ? '...' : ''}`
- DetailedCard 现有 `isRecommended && !selected` 守卫保留

**理由**:
- 现状 CoverCard 用 `border-l-2`(recommended)与 `ring-2`(selected)是不同 CSS 属性,天然不冲突,所以原本**没有守卫**
- 本变更为 CoverCard 推荐态新增任何视觉属性后,必须显式加 `!selected` 守卫,确保选中态优先级生效
- 优先级 `selected > recommended` 符合"用户主动操作 > 后台推荐"的直觉

**替代方案**:
- 两个视觉信号都显示:复杂度高,视觉杂乱,否决
- recommended 优先于 selected:违背用户主动操作直觉,否决

### 决策 5:CoverCard 整圈高亮必须用内描边(inset shadow)而非外环(ring)

**选择**:`shadow-[inset_0_0_0_2px_rgba(245,158,11,0.8)]`(内描边)而非 `ring`(外环)

**理由**(实现过程中发现的关键约束):
- 初版用 `ring-2 ring-amber-400/80`(外环),视觉强度合适
- 手动验证发现:网格最左列/最右列的推荐卡片紧贴窗口边缘时,外环会**溢出视口**——要么被裁切(高亮不完整),要么撑出横向滚动条
- `ring` 是 `box-shadow` 绘制于元素 box **外部**的机制,溢出是其固有特性
- 改为 `inset` box-shadow(内描边)绘制于元素**内侧**,无论卡片在网格何处都不溢出,彻底解决问题

**替代方案**:
- 给网格容器加 padding 容纳外环:侵入性强,改变所有卡片(含非推荐)布局,否决
- 给容器加 `overflow-visible`:可能引发其他滚动问题,否决
- 外环溢出不管:视觉效果受损(边缘卡片高亮残缺),否决

## 风险 / 权衡

**[风险] 深色模式下 `bg-amber-500/5` 背景几乎不可见** → `ring-1 ring-amber-400/50` 作为主信号在任何模式下都可见,背景色只是锦上添花的辅助。即使背景不可见,推荐态仍有清晰环信号,可接受。

**[风险] 用户从旧版升级时视觉变化明显** → 这正是本变更的目的(提升可发现性),视觉变化是预期的、正向的。无需迁移或灰度。

**[权衡] 推荐是二元的(命中 1 和命中 8 视觉相同)** → 本变更聚焦"可发现性"层次,推荐强度分级留作未来探索方向。当前方案已明确排除强度分级。

**[风险] 测试断言需更新** → 现有测试 `ComicCard.test.tsx:294-301` 断言 `border-l-2 border-l-amber-400/70`,CoverCard 改用整圈高亮后这些断言会失败。已在 tasks 3.1-3.4 中完成更新,35 个测试全过。

**[风险] CoverCard 整圈高亮可能溢出视口**(实现中发现) → 网格最左/最右列卡片紧贴窗口边缘时,外环(`ring`)的高亮会溢出视口被裁切。已在决策 5 中通过改用 `inset` 内描边彻底解决。此约束已写入 spec 作为硬性要求(禁止用 `ring` 实现 CoverCard 推荐态)。

