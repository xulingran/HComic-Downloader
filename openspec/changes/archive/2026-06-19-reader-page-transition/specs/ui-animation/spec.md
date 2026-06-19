## 新增需求

> 本增量向 `ui-animation` capability 新增阅读器翻页过渡的行为契约。

### 需求: 阅读器 single 与 double 模式必须使用横向滑动翻页过渡

当 displayMode 为 `single` 或 `double` 时，currentPage 变化**必须**触发横向滑动过渡：新页从相反方向滑入、旧页向用户离开方向滑出；过渡时长约 250ms，使用 smooth 曲线（cubic-bezier(0.4, 0, 0.2, 1)），**禁止**使用会 overshoot 的 spring 曲线。

#### 场景: single 模式向前翻页

- **当** 用户在 single 模式触发向前翻页（currentPage 增加，direction='forward'）
- **那么** 旧页向左滑出、新页从右滑入，250ms smooth 曲线

#### 场景: single 模式向后翻页

- **当** 用户触发向后翻页（currentPage 减少，direction='backward'）
- **那么** 旧页向右滑出、新页从左滑入

#### 场景: double 模式两页整体滑动

- **当** 用户在 double 模式翻页
- **那么** 左右两页作为整体同时滑动（同一 transform），不出现撕裂

#### 场景: double 模式空白页参与过渡

- **当** double 模式且 blankPosition 为 front 或 end，翻页经过空白页位置
- **那么** 空白页（BlankPage）作为整体的一部分参与滑动，**禁止**半屏闪烁

### 需求: 翻页方向必须由 PageFlipView 内部根据 currentPage 变化推断

系统**必须**在 PageFlipView 内部维护上一次 currentPage，根据新旧值差值推断方向（forward / backward），**禁止**要求外部调用方传入方向参数。

#### 场景: 键盘 ArrowRight 触发向前

- **当** 用户按 ArrowRight，currentPage 从 5 变为 6
- **那么** PageFlipView 推断 direction='forward'，新页从右滑入

#### 场景: 滑块拖动触发向后

- **当** 用户拖动滑块，currentPage 从 10 变为 3
- **那么** PageFlipView 推断 direction='backward'，新页从左滑入

### 需求: 翻页动画期间必须禁用 panOffset 拖拽

翻页过渡进行中，页面容器**必须**禁用 pointer 事件（`pointer-events: none`），**禁止**在动画期间触发 panOffset 拖拽，避免 transform 冲突。动画结束后恢复 pointer 事件。

#### 场景: 翻页中按下鼠标不触发拖拽

- **当** 翻页动画进行中（约 250ms），用户按下鼠标
- **那么** 不触发 panOffset 拖拽；动画结束后才能拖拽

### 需求: wheel 翻页节流必须与动画时长大致对齐

wheel 触发翻页的节流**必须**保证上一次翻页动画基本完成后才响应下一次 wheel，**禁止**固定 200ms 节流导致 AnimatePresence 内页面层堆积。

#### 场景: 连续滚轮快速翻页

- **当** 用户快速滚动滚轮触发多次翻页
- **那么** 每次翻页动画基本完成后才响应下一次 wheel，不出现多层页面叠加

### 需求: scroll 模式必须保持现状无翻页过渡

displayMode 为 `scroll` 时，**禁止**引入翻页过渡；scroll 模式走连续滚动渲染分支，本变更不触及。

#### 场景: scroll 模式翻页无过渡

- **当** displayMode='scroll' 且 currentPage 变化
- **那么** 保持现有连续滚动行为，无横向滑动过渡

### 需求: 翻页过渡必须在 reduced-motion 下退化为 opacity crossfade

当 `prefers-reduced-motion: reduce` 为真时，翻页过渡**必须**退化为纯 opacity crossfade（约 150ms），**禁止**产生横向位移。

#### 场景: reduced-motion 下翻页无位移

- **当** 用户启用「减少动画」且翻页
- **那么** 新页 opacity 0→1 淡入，旧页淡出，无 translateX
