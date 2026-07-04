## 上下文

`PageFlipView.tsx`（src/components）的 click-to-flip overlay 现状（第 288–322 行）：

```jsx
<div className="absolute inset-0 flex pointer-events-none">
  <button className="w-[40%] h-full pointer-events-auto ...">  ← 上一页
    <svg /* hover 显示 ← */ />
  </button>
  <button className="w-[60%] h-full pointer-events-auto ...">  ← 下一页
    <svg /* hover 显示 → */ />
  </button>
</div>
```

两个 `<button>` 横向 `flex` 铺满 `inset-0`，`pointer-events-auto` + `onPointerDown stopPropagation`。这导致：

- **整屏都是点击翻页区**：除按钮自身无其他落点，鼠标点哪儿都被某个按钮捕获。
- **拖拽平移被抢**：zoom > 1 时容器的 `handlePointerDown`（平移入口）拿不到 pointerdown，按钮的 `stopPropagation` 切断了冒泡链。即便用户在画面正中央按下，事件也被所在按钮吞掉。

容器拖拽平移由 `containerRef` 上的 `onPointerDown/Move/Up` 处理（第 252–255 行），与点击翻页是两套独立 handler，靠 pointerdown 冒泡链分工：按钮 `stopPropagation` 表示"这是翻页点击"，不 stop 则冒泡到容器走平移。这是本次设计必须保留的不变量。

`isFlipping` 门控（由 `reader-flip-input-gating` 规范约束）作用于 `goNext/goPrev` 内部与 wheel，与几何无关；本变更不改门控。

## 目标 / 非目标

**目标：**
- 把点击翻页热区收到左右边缘约 20% 宽，中央约 60% 留给拖拽平移。
- 保留现有 hover 显示箭头视觉，不增加常驻 UI 元素。
- 保持左右对称（旧实现 40/60 不对称是历史遗留，无实际意义）。
- 不破坏既有翻页输入路径：键盘、滚轮、滑块、`isFlipping` 门控、边界翻章。

**非目标：**
- 不引入 zoom 条件逻辑（zoom = 1 时误触同样存在；条件化会让"哪里能点翻页"变成隐式规则）。
- 不改翻页动画 variants、方向推断、连续滚动模式（非 `PageFlipView` 渲染分支）。
- 不引入设置项让用户自定义条带宽度（YAGNI；20% 是合理默认）。
- 不做触摸屏专项适配（项目当前以桌面为主；触摸点击落在边缘条带内仍可翻页，体验可接受）。

## 决策

### 决策 1：用"三段 flex 布局 + 中间 `pointer-events-none`"实现安全区

新 overlay 结构：

```jsx
<div className="absolute inset-0 flex pointer-events-none">
  <button className="w-1/5 h-full pointer-events-auto ...">  ← 左边缘，20%
    <svg /* hover ← */ />
  </button>
  <div className="flex-1 h-full pointer-events-none" />         ← 中央安全区，~60%
  <button className="w-1/5 h-full pointer-events-auto ...">  ← 右边缘，20%
    <svg /* hover → */ />
  </button>
</div>
```

中央用 `flex-1`（约 60%）+ `pointer-events-none`，使该区域的 pointer 事件穿透 overlay，落到容器的拖拽/滚轮 handler 上。左右按钮仍是 `pointer-events-auto` + `onPointerDown stopPropagation`，保留"按钮内即翻页点击"的语义。

**为什么不用绝对定位 + `left/right` 偏移**：`absolute left-0 w-1/5` / `absolute right-0 w-1/5` 也可，但需要为每个按钮写四条定位规则，且中央"无元素"靠 absence 隐式实现——拖拽安全区是"显式留白"还是"缺席"，flex 三段式把安全区表达为一个真实元素，语义更清晰，未来若想在安全区叠加提示也方便。

**为什么左右各 20% 而非其他比例**：
- 15%：触摸目标偏小（窄屏 800px 宽时仅 120px），但桌面鼠标足够。
- 25%：安全区缩到 50%，zoom 后拖拽空间仍偏紧。
- 20%：参考 Mihon/Tachiyomi、HakuNeko 等主流漫画阅读器的边缘热区惯例，桌面鼠标点击与触摸点击都够用，安全区留足 60%。

**为什么 `w-1/5` 而非 `w-[20%]`**：Tailwind 已有 `w-1/5`（=20%），无需任意值；与现有代码 `w-[40%]` 风格略不同，但 `w-1/5` 更地道且无魔法数字。

### 决策 2：保留 `onPointerDown stopPropagation`，仅缩小其作用域

按钮上的 `onPointerDown={(e) => e.stopPropagation()}` **保留**，但仅作用于 20% 边缘区。它的作用是阻止按钮的 pointerdown 冒泡到容器 `handlePointerDown`（否则会同时触发翻页 click + 进入平移 isPanning 状态）。安全区没有按钮，pointerdown 自然冒泡到容器——这正是我们想要的。

**为什么不在容器 handler 内用"事件来源元素"判断**：那需要在 `handlePointerDown` 里检查 `e.target` 是否在按钮内，把 UI 结构耦合进平移逻辑。`stopPropagation` 是更干净的责任边界：按钮自治地说"这是我的事件"。

### 决策 3：箭头视觉零改动

左右箭头的 `svg`、`opacity-0 group-hover:opacity-100`、`group` class、定位（`justify-start pl-4` / `justify-end pr-4`）全部保留。条带变窄后箭头仍贴在最外缘，视觉无变化。**不**改成常驻可见——提案已定调保持低视觉噪音。

## 风险 / 权衡

- **[窄屏触摸目标变小]** 边缘 20% 在 800px 窗口下约 160px，仍大于触摸友好阈值（~88px），可接受。→ 缓解：若未来报窄屏难戳，可加 `min-w` 兜底，但当前不开窗。
- **[用户习惯整屏可点]** 长期依赖"点画面中间翻页"的用户会感到行为变化。→ 缓解：键盘/滚轮/滑块仍是主流路径，点击翻页是辅助；且安全区让拖拽平移可用，净收益为正。文档/无障碍标签（`aria-label`）不变。
- **[双页模式下中央缝隙归属]** double 模式两页间有 4px gap，落在哪一侧？现在 gap 由中央安全区覆盖（pointer 穿透到容器），不会误触发任一侧翻页——这其实比旧实现（gap 落在 60% 右按钮内）更正确。→ 无需额外处理。
- **[回归：旧测试若依赖 40/60 几何]** 项目测试质量闸门禁止"仅断言 mock 被调用"，但若有测试断言了按钮宽度 class 需同步更新。→ 缓解：tasks 中包含测试同步步骤；apply 前跑 `npm test`。

## 迁移计划

纯前端单组件改动，无数据/配置/IPC 迁移。

- 部署：随下次发布；无需用户操作。
- 回滚：revert 单个 commit 即可，无副作用。
- 验证：`npm test`（组件测试）+ 手动验证（zoom > 1 中央拖拽、边缘点击翻页、滚轮、键盘）。

## 待解决问题

（无。20% 比例、三段 flex、保留 stopPropagation 均已在决策中确定。）
