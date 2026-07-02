## 修改需求

### 需求:CoverCard 推荐态必须使用整圈内描边高亮而非单边边框

当 `isRecommended` 为真且卡片未处于选中态时,CoverCard(网格视图卡片)**必须**使用整圈琥珀色内描边高亮(`inset` box-shadow 形式,绘制于卡片内侧),配合琥珀背景色呈现整体高亮效果,**禁止**继续使用单边左边框(可发现性不足,在密集网格中易被淹没),**禁止**使用绘制于元素外部的 `ring`(卡片紧贴窗口边缘时外环会溢出视口)。

色值加深至:背景 `bg-amber-500/15`;内描边色阶 `amber-600`(RGB `217,119,6`)、不透明度 `0.9`,以提升深色背景下的辨识度。

#### 场景:CoverCard 推荐态呈现整圈琥珀内描边与背景色

- **当** CoverCard 的 `isRecommended` 为 `true` 且 `selected` 不为 `true`
- **那么** 卡片根元素应用琥珀色内描边(2px、约 90% 不透明度、色阶 amber-600)与琥珀背景色(`bg-amber-500/15`)
- **并且** 不再应用 `border-l-2 border-l-amber-400/70`

#### 场景:CoverCard 推荐高亮必须不溢出视口

- **当** 推荐卡片位于网格最左列或最右列(紧贴视口边缘)
- **那么** 推荐高亮必须使用内描边(`inset` box-shadow)绘制于卡片内侧
- **禁止** 使用 `ring`(外环)导致高亮被视口裁切或撑出横向滚动条

#### 场景:CoverCard 未推荐时不显示任何推荐样式

- **当** CoverCard 的 `isRecommended` 不为 `true`(或未传入)
- **那么** 卡片根元素不包含琥珀内描边、`bg-amber-500` 等推荐态类名

### 需求:DetailedCard 推荐态必须保留加粗左边框并补充琥珀背景

DetailedCard(列表视图卡片)的推荐态**必须**保留左侧边框而非改为整圈(列表行紧贴,整圈会让连续推荐行连成色块),但**必须**使用足够粗的实色边框(≥ 4px)以保证可发现性,**必须**补回琥珀背景色。

色值加深至:左边框色阶 `amber-500`(原 amber-400);背景 `bg-amber-500/15`(原 `/10`)。tag 气泡色阶见下方"DetailedCard 命中推荐标签的样式"需求。

#### 场景:DetailedCard 推荐态呈现加粗实色左边框与背景色

- **当** DetailedCard 的 `isRecommended` 为 `true` 且 `selected` 不为 `true`
- **那么** 卡片根元素应用实色琥珀左边框(4px、色阶 amber-500)与琥珀背景色(`bg-amber-500/15`)
- **并且** 不再应用 `border-l-2 border-l-amber-400/70`

#### 场景:DetailedCard 既推荐又被选中时只显示选中态

- **当** DetailedCard 的 `isRecommended` 与 `selected` 同时为 `true`
- **那么** 卡片根元素只显示选中态的 `border-l-2 border-l-[var(--accent)] bg-[var(--accent)]/5`
- **并且** 不包含 `border-l-amber-400` 或 `bg-amber-500` 推荐态类名

### 需求:DetailedCard 命中推荐标签的样式必须保持不变

DetailedCard 内命中 `recommendedTags` 的 tag 气泡**必须**使用琥珀色样式,未命中的 tag 保持默认 accent 样式。色值加深至 `bg-amber-500/20 text-amber-700`(原 `bg-amber-500/15 text-amber-600`),hover 为 `bg-amber-500/30`(原 `/25`)。

详情抽屉(`ComicInfoDrawer`)中命中 `recommendedTags` 的 tag 气泡**必须**与卡片 chip 使用相同的琥珀色值(`bg-amber-500/20 text-amber-700`、hover `bg-amber-500/30`),以保持两处视觉一致(原代码注释已明示要求一致)。

#### 场景:DetailedCard 命中 tag 保持琥珀色

- **当** DetailedCard 渲染 tag 列表,某 tag 的小写形式存在于 `recommendedTags` 集合中
- **那么** 该 tag 气泡应用 `bg-amber-500/20 text-amber-700`(hover `bg-amber-500/30`)
- **当** 某 tag 不在 `recommendedTags` 中或 `recommendedTags` 未提供
- **那么** 该 tag 气泡应用默认 `bg-[var(--accent)]/10 text-[var(--accent)]`

#### 场景:recommendedTags 匹配保持大小写不敏感

- **当** `recommendedTags` 包含 `'ntr'`,漫画 tag 包含 `'NTR'`
- **那么** 该 tag 气泡被判定为命中并使用琥珀色样式

#### 场景:详情抽屉命中 tag 与卡片 chip 色值一致

- **当** 详情抽屉渲染某漫画 tag,该 tag 小写形式存在于 `recommendedTags` 集合中
- **那么** 该 tag 气泡应用与 DetailedCard chip 相同的 `bg-amber-500/20 text-amber-700`(hover `bg-amber-500/30`)
- **并且** 不得使用旧的 `bg-amber-500/15 text-amber-600` 色值
