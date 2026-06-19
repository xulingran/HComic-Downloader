## 修改需求

> 本增量向 `ui-animation` capability 已有的「reduced-motion」与「transition-all」需求补充性能约束，新增性能护栏需求。

### 需求: 项目必须通过 Tailwind 令牌集中管理动画时长

（已有需求，补充约束）系统**必须**在所有 framer-motion 容器与 layout 动画组件上避免常驻 `will-change`，**应该**仅在动画即将开始时通过 framer-motion 的内置优化或显式 style 提供 `will-change` hint，**禁止**在静态元素上常驻 `will-change: transform`。

#### 场景: 翻页动画期间启用合成层

- **当** PageFlipView 翻页动画进行中
- **那么** 翻页 motion.div 提示 `will-change: transform`，动画结束后移除（由 framer-motion 自动管理）

### 需求: 项目必须定义可复用的 keyframes

（已有需求，补充约束）长列表的 layout 动画与 stagger **必须**封顶参与项数（STAGGER_LIMIT=20），**必须**配合 CSS `contain: layout` 限制重排范围，**禁止**长列表全量动画导致主线程长任务。

#### 场景: 200 项搜索结果的 layout 动画不卡顿

- **当** 搜索返回 200 张卡片且触发 layout 动画
- **那么** 仅前 20 项参与 stagger，所有卡片用 contain:layout 隔离，无主线程长任务（>50ms）

## 新增需求

### 需求: framer-motion 引入的 bundle 增量必须可接受

framer-motion 全量引入后，renderer bundle 增量**必须**控制在 ~300KB（gzip ~90KB）以内，**禁止**因动画库引入导致首屏加载明显劣化。Electron 桌面应用对包体积不敏感，本约束作为基线监控。

#### 场景: build 后 renderer bundle 不超过基线

- **当** 执行 npm run build
- **那么** renderer JS bundle 不超过 ~1MB（含 framer-motion），CSS 不超过 ~50KB
