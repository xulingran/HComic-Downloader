# ui-animation 规范

## 目的
待定 - 由归档变更 animation-foundation 创建。归档后请更新目的。
## 需求
### 需求: 项目必须通过 Tailwind 令牌集中管理动画时长

（已有需求，补充约束）系统**必须**在所有 framer-motion 容器与 layout 动画组件上避免常驻 `will-change`，**应该**仅在动画即将开始时通过 framer-motion 的内置优化或显式 style 提供 `will-change` hint，**禁止**在静态元素上常驻 `will-change: transform`。

#### 场景: 翻页动画期间启用合成层

- **当** PageFlipView 翻页动画进行中
- **那么** 翻页 motion.div 提示 `will-change: transform`，动画结束后移除（由 framer-motion 自动管理）

### 需求: 项目必须通过 Tailwind 令牌集中管理动画曲线

系统必须在 `theme.extend.transitionTimingFunction` 中定义语义化的曲线令牌，所有容器级动画应使用令牌类名（如 `ease-spring`）而非裸 `ease-out`。

#### 场景: 容器动画使用 spring 弹性曲线

- **当** 组件渲染弹窗进出场、需要"弹一下"质感的动画
- **那么** 使用 `ease-spring`（cubic-bezier(0.34, 1.56, 0.64, 1)）令牌

#### 场景: 普通过渡使用平滑曲线

- **当** 组件渲染位置过渡、平移类动画
- **那么** 使用 `ease-smooth`（cubic-bezier(0.4, 0, 0.2, 1)）令牌

### 需求: 项目必须定义可复用的 keyframes

（已有需求，补充约束）长列表的 layout 动画与 stagger **必须**封顶参与项数（STAGGER_LIMIT=20），**必须**配合 CSS `contain: layout` 限制重排范围，**禁止**长列表全量动画导致主线程长任务。

#### 场景: 200 项搜索结果的 layout 动画不卡顿

- **当** 搜索返回 200 张卡片且触发 layout 动画
- **那么** 仅前 20 项参与 stagger，所有卡片用 contain:layout 隔离，无主线程长任务（>50ms）

### 需求: 系统必须在用户启用"减少动画"时全局降级动画

系统必须在 `src/styles/index.css` 中定义 `@media (prefers-reduced-motion: reduce)` 全局规则，把所有 CSS transition 与 animation 的持续时间压缩到 0.01ms，作为兜底防御。

#### 场景: Windows 关闭"播放动画"时所有 CSS 动画瞬时完成

- **当** 用户在 Windows 系统设置中关闭「视觉效果 → 在以下位置播放动画」
- **那么** 应用内所有 CSS transition 与 keyframe animation 几乎瞬时完成（duration 0.01ms）

#### 场景: 即使组件忘记处理 reduced-motion，全局规则仍生效

- **当** 后续新增的组件未在代码中读取 `prefers-reduced-motion`
- **那么** 该组件的 CSS 动画仍被全局规则压缩为瞬时

### 需求: 项目必须提供共享动画 variants 的集中导出

系统必须在 `src/lib/anim.ts` 中导出共享的 framer-motion variants、duration 常量与 `useReducedMotion` 薄封装，供后续变更（animation-consistency、reader-page-transition、list-enter-exit、skeleton-loader）按需消费。

#### 场景: 后续变更导入共享 spring variant

- **当** 变更 2 把 Modal 迁移到 framer-motion
- **那么** 从 `src/lib/anim.ts` 导入 `springTransition` variant，而不是在各组件内重复定义

#### 场景: variants 内置 reduced-motion 退化

- **当** 共享 variants 被 motion 组件消费
- **那么** variants 内部已处理 reduced-motion 退化路径，组件无需重复判断

### 需求: 组件必须避免使用 transition-all，改用精确属性

除复合 hover 场景外，系统**必须**避免在动画组件上使用 `transition-all`（会监听所有属性变化，增加浏览器比对开销），改用 `transition-[property]` 或 `transition-colors` / `transition-shadow` / `transition-transform` / `transition-opacity` 等精确形式。对于 hover 涉及多种属性的复合交互（如同时改变背景色、阴影、文字色），可保留 `transition-all`，但**必须**在类名旁加注释说明原因。

#### 场景: 仅 opacity + transform 的容器动画使用精确属性

- **当** 组件（如 Modal 内层）的动画只涉及 opacity 与 transform
- **那么** 使用 `transition-[opacity,transform]` 而非 `transition-all`

#### 场景: 仅 box-shadow 的 hover 使用精确属性

- **当** 组件（如 ComicCard CoverCard）的 hover 只改变阴影
- **那么** 使用 `transition-shadow` 而非 `transition-all`

#### 场景: 复合 hover 可保留 transition-all 并加注释

- **当** 组件（如 Sidebar）的 hover 同时改变背景色、阴影、文字色
- **那么** 可保留 `transition-all`，但在类名旁加注释说明为何不拆分

### 需求: 所有容器级弹窗必须使用 framer-motion AnimatePresence 驱动进出场

系统**必须**用 framer-motion 的 `AnimatePresence` 替代手动 mounted/visible state 管理，让退出动画由框架自动调度，所有弹窗共享 `src/lib/anim.ts` 中的 variants，曲线与时长由令牌统一。

#### 场景: Modal 进出场用 scale + opacity spring

- **当** 用户打开或关闭一个 Modal
- **那么** 内层用 `modalPresenceVariants`（opacity 0→1、scale 0.95→1，spring 曲线），退出时反向播放

#### 场景: ComicInfoDrawer 从右滑入

- **当** 用户打开详情抽屉
- **那么** 抽屉用 `drawerPresenceVariants`（x 100%→0，spring 曲线），退出时向右滑出

#### 场景: ComicReaderModal 从下滑入

- **当** 用户打开阅读器
- **那么** 阅读器用 `readerPresenceVariants`（y 100%→0，spring 曲线）；退出时整组件立即卸载（全屏接管场景的有意妥协，无 exit 动画）

#### 场景: Toast 从上方滑入

- **当** Toast 显示
- **那么** Toast 用 `toastPresenceVariants`（y -1rem→0 + opacity，spring 曲线），退出时反向

### 需求: ComicInfoDrawer 的 tag 列表必须错峰出现

ComicInfoDrawer 内的标签列表在抽屉打开时**必须**以 `staggerChildren` 错峰出现，每个 tag 延迟约 30ms；前 20 个 tag 参与错峰，第 21 个及之后立即出现，**禁止**长 tag 列表全量错峰导致总时长过长。

#### 场景: 抽屉打开时 tag 错峰

- **当** ComicInfoDrawer 打开且包含 N 个 tag（N ≤ 20）
- **那么** tag 按 30ms 间隔依次淡入上移，总时长约 N×30ms + 起始延迟 100ms

#### 场景: tag 超过 20 个时封顶

- **当** ComicInfoDrawer 包含超过 20 个 tag
- **那么** 仅前 20 个参与错峰，第 21 个及之后立即出现，避免总时长超过 0.7s

### 需求: Modal 的安全遮罩点击逻辑必须保留

Modal 迁移到 AnimatePresence 后，**必须**保留「mousedown 与 click 均落在遮罩本身才触发关闭」的方案 A 判定，**禁止**因 motion.div 替换 div 而丢失拖选文字逸出场景的 bug 修复。

#### 场景: 拖选文字逸出不触发关闭

- **当** 用户在内层输入框 mousedown、拖到遮罩 mouseup（click 落在遮罩）
- **那么** 不触发 onClose（与迁移前行为一致）

### 需求: 阅读器 single 与 double 模式必须使用横向滑动翻页过渡

当 displayMode 为 `single` 或 `double` 时，currentPage 变化**必须**触发横向滑动过渡：新页从相反方向滑入、旧页向用户离开方向滑出；过渡**必须**显式使用 `smoothTransition`（`DURATION.slow`，约 300ms，cubic-bezier(0.4, 0, 0.2, 1)），**禁止**省略 transition 导致 framer-motion 回退到会 overshoot 的默认 spring 曲线。普通动画路径的进入与退出端点**必须**使用轻微 opacity 变化柔化新旧页交替，中心状态保持完全不透明。

#### 场景: single 模式向前翻页

- **当** 用户在 single 模式触发向前翻页（currentPage 增加，direction='forward'）
- **那么** 旧页向左滑出、新页从右滑入，使用约 300ms smooth 曲线，无 overshoot，并带轻微 opacity 柔化

#### 场景: single 模式向后翻页

- **当** 用户触发向后翻页（currentPage 减少，direction='backward'）
- **那么** 旧页向右滑出、新页从左滑入，使用约 300ms smooth 曲线，无 overshoot，并带轻微 opacity 柔化

#### 场景: double 模式两页整体滑动

- **当** 用户在 double 模式翻页
- **那么** 左右两页作为整体同时滑动（同一 transform），不出现撕裂

#### 场景: double 模式空白页参与过渡

- **当** double 模式且 blankPosition 为 front 或 end，翻页经过空白页位置
- **那么** 空白页（BlankPage）作为整体的一部分参与滑动，**禁止**半屏闪烁

#### 场景: 翻页 variants 显式声明 transition

- **当** 普通横向翻页 variants 被生成
- **那么** center 与 exit 变体显式包含 `smoothTransition`，**禁止**缺失 transition

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

### 需求: ComicCard 网格必须使用 framer-motion layout 动画实现进出场与位置过渡

搜索、收藏、历史页面的 ComicCard 网格**必须**用 framer-motion 的 `AnimatePresence` + `layout` prop 实现卡片进出场与位置变化过渡，**禁止**瞬间切换或跳变。

#### 场景: 搜索结果切换时卡片淡入上移

- **当** 用户执行新搜索或切换筛选，filteredComics 列表变化
- **那么** 新出现的卡片以 opacity 0→1 + y 8px→0 淡入上移，旧卡片淡出

#### 场景: cardStyle 切换时位置平滑过渡

- **当** 用户在 cover 与 detailed 卡片样式之间切换
- **那么** 卡片位置用 layout 动画平滑过渡，而非瞬间从 grid 跳变到 flex

#### 场景: 卡片被移除时剩余卡片归位

- **当** 某张卡片从列表中移除（如取消收藏、加入黑名单）
- **那么** 移除的卡片缩小淡出，剩余卡片用 layout 动画平滑归位

### 需求: 列表进出场 stagger 必须封顶前 20 项

ComicCard 网格的错峰进出场**必须**仅对前 20 项应用 stagger delay（每项约 20ms），第 21 项及之后**必须**立即出现（delay=0），**禁止**长列表全量 stagger 导致总时长过长。

#### 场景: 搜索返回 50 项时 stagger 封顶

- **当** 搜索返回 50 张卡片
- **那么** 仅前 20 张错峰出现（总时长约 400ms），第 21-50 张立即出现

### 需求: DownloadPage 任务列表必须支持任务进出场动画

下载管理页面的顶层任务项**必须**用 AnimatePresence + layout 实现进入（从顶部滑入）与退出（缩小淡出）动画，任务重排时位置变化**必须**平滑过渡。

#### 场景: 新任务进入时从顶部滑入

- **当** 一个新下载任务加入队列
- **那么** 该任务项从顶部滑入（y -8px→0 + opacity），其余任务用 layout 下移

#### 场景: 任务完成移除时缩小淡出

- **当** 一个任务从列表移除（完成清理或取消）
- **那么** 该任务项缩小（scale 1→0.9）+ 淡出，剩余任务用 layout 归位

### 需求: 列表动画必须在 reduced-motion 下退化为纯 opacity

当 `prefers-reduced-motion: reduce` 为真时，ComicCard 网格与 DownloadPage 任务列表的 layout 动画**必须**关闭，进出场退化为纯 opacity 淡入淡出，**禁止**产生位移或缩放。

#### 场景: reduced-motion 下卡片无位移

- **当** 用户启用「减少动画」且搜索结果切换
- **那么** 卡片仅 opacity 淡入淡出，无 y 位移、无 scale、无 layout 重排动画

### 需求: 项目必须提供通用 Skeleton 组件用于加载占位

系统**必须**提供 `src/components/common/Skeleton.tsx` 通用骨架组件，支持 `variant: 'rect' | 'text' | 'circle'`，配色用 `--bg-secondary` 基底 + `--bg-tertiary` 高光，动画用变更 1 定义的 `shimmer` keyframe。

#### 场景: rect 变体用于封面占位

- **当** 组件需要为图片封面显示骨架
- **那么** 使用 variant='rect'（rounded-lg），aspect-ratio 与最终封面一致

#### 场景: text 变体用于文本占位

- **当** 组件需要为标题/作者文本显示骨架
- **那么** 使用 variant='text'（rounded），高度匹配文本行高

### 需求: ComicCard 封面加载必须用骨架屏替代 spinner

当封面图片正在加载（coverSrc === undefined 且有 coverUrl）时，ComicCard 的 CoverImage **必须**显示 Skeleton 占位，**禁止**使用 SVG spinner。

#### 场景: 封面加载中显示骨架

- **当** 封面图片尚未加载完成
- **那么** 显示与封面 aspect-ratio 一致的 rect 骨架，shimmer 动画

#### 场景: 骨架尺寸与封面一致避免布局抖动

- **当** 封面从骨架切换为真实图片
- **那么** 骨架与图片 aspect-ratio 严格一致（cover 用 aspect-[6/7]），无布局抖动

### 需求: 阅读器首屏加载必须用骨架屏替代 spinner

当阅读器页面图片尚未加载（PageFlipView 的 FlipPage 无 dataUri）时，**必须**显示占满阅读区的 Skeleton，**禁止**使用小尺寸 SVG spinner。

#### 场景: 阅读器页面加载中显示全屏骨架

- **当** 阅读器某页图片尚未加载完成
- **那么** 显示占满阅读区的 rect 骨架（h-full），shimmer 动画

### 需求: 搜索结果加载必须显示骨架网格

当搜索正在进行（isLoading）且尚无结果（filteredComics 为空）时，SearchPage **必须**渲染骨架网格（约 12 张骨架卡片），**禁止**显示空白或仅 spinner。

#### 场景: 搜索中显示骨架网格

- **当** isLoading 为 true 且 filteredComics 为空
- **那么** 渲染 12 张 aspect-[6/7] 骨架卡片，shimmer 动画

#### 场景: 已有结果时不显示骨架

- **当** isLoading 为 true 但已有 filteredComics（如分页加载）
- **那么** 保持显示现有结果，不闪烁骨架

### 需求: 骨架屏 shimmer 必须在 reduced-motion 下退化为静态渐变

当 `prefers-reduced-motion: reduce` 为真时，Skeleton 的 shimmer 动画**必须**关闭，只显示静态渐变背景，**禁止**产生移动。

#### 场景: reduced-motion 下骨架无移动

- **当** 用户启用「减少动画」且看到骨架
- **那么** 骨架显示静态渐变背景，无 shimmer 移动

### 需求: framer-motion 引入的 bundle 增量必须可接受

framer-motion 全量引入后，renderer bundle 增量**必须**控制在 ~300KB（gzip ~90KB）以内，**禁止**因动画库引入导致首屏加载明显劣化。Electron 桌面应用对包体积不敏感，本约束作为基线监控。

#### 场景: build 后 renderer bundle 不超过基线

- **当** 执行 npm run build
- **那么** renderer JS bundle 不超过 ~1MB（含 framer-motion），CSS 不超过 ~50KB

### 需求: Tab 切换必须具有方向感知的过渡动画

系统在用户切换 tab 时，必须根据导航方向播放 slide + opacity 过渡动画：向"右"导航（索引增大）时，新页面从右侧 8% 处滑入同时旧页面从原位置向左滑出；向"左"导航（索引减小）时方向相反。导航方向由目标 tab 与当前 tab 在 TAB_ORDER 中的索引差决定。

#### 场景：用户点击右侧 tab
- **当** 用户当前在「搜索」tab 且点击「下载管理」tab
- **那么** 当前页面向左滑出，同时下载管理页面从右侧 8% 处滑入

#### 场景：用户点击左侧 tab
- **当** 用户当前在「关于」tab 且点击「工具箱」tab
- **那么** 当前页面向右滑出，同时工具箱页面从左侧 8% 处滑入

#### 场景：用户点击同一个 tab
- **当** 用户当前在「搜索」tab 且再次点击「搜索」tab
- **那么** 不播放任何过渡动画（方向为 0）

### 需求：首次加载必须为纯淡入

应用首次加载时（无前一个 tab），当前页面必须只做 opacity 过渡（0 → 1），无位移滑动。

#### 场景：应用首次启动
- **当** 用户打开应用，首次渲染搜索页面
- **那么** 搜索页面以淡入方式出现（opacity 0 → 1），无任何位移

### 需求：reduced-motion 偏好必须被尊重

当用户操作系统开启了 reduced-motion 偏好时，所有 tab 过渡必须退化为纯 opacity crossfade（无位移、无缩放），时长压缩至 `DURATION.fast`（150ms）。

#### 场景：reduced-motion 开启时切换 tab
- **当** 用户操作系统启用了 reduced-motion 且用户切换 tab
- **那么** 页面过渡仅使用 opacity crossfade（0 ↔ 1），时长 150ms，无任何位移

### 需求：程序化跳转必须触发动画

通过 `onNavigateToSettings`（SearchPage/FavouritesPage 调用）、`pendingSearch`（ComicInfoDrawer 调用）发起的程序化页面跳转，必须同样触发方向感知的过渡动画，方向由索引差自然决定。

#### 场景：通过 onNavigateToSettings 跳转
- **当** 用户点击搜索页面的「跳到设置」按钮
- **那么** 搜索页面滑出，设置页面从对应方向滑入

#### 场景：通过 pendingSearch 自动跳转
- **当** 用户在漫画信息抽屉中点击搜索漫画名
- **那么** 当前页面滑出，搜索页面从对应方向滑入

### 需求：所有 overlay 组件必须不受 tab 过渡影响

Toast、Toaster、ComicInfoDrawer、ComicReaderModal、FatalBanner、UpdateDialog 这些 overlay 组件在 tab 过渡期间必须保持其现有行为，不应跟随页面一起滑动或消失。

#### 场景：overlay 在 tab 过渡期间保持稳定
- **当** 用户有一个打开的 ComicInfoDrawer 时切换 tab
- **那么** ComicInfoDrawer 保持其现有位置和状态，不随页面过渡移动

### 需求：mode 必须为 "sync"

Tab 页面过渡使用 `<AnimatePresence mode="sync">`（AnimatePresence 默认行为），exit 和 enter 同时播放，旧页滑出的同时新页滑入，形成连续"推送"效果，**禁止**使用 `mode="wait"` 导致过渡延迟感。

#### 场景：过渡期间新旧页面同时可见
- **当** 用户在 tab A 并切换到 tab B
- **那么** tab A 滑出与 tab B 滑入同时发生（`mode="sync"`），在过渡中段约 150ms 窗口内两页共存于视口，形成连续推送效果；exit 动画播放完毕后旧 DOM 被移除

### 需求：Tab 动画时长和曲线必须统一

Tab 页面过渡必须使用 `DURATION.slow`（300ms）时长和 `smoothTransition` 曲线（cubic-bezier(0.4,0,0.2,1)），以确保与项目其他动画（翻页、卡片列表）的节奏一致。禁止使用 spring 曲线（避免 overshoot）。

#### 场景：过渡播放过程中
- **当** 用户切换 tab
- **那么** 过渡动画在 300ms 内完成，使用 smooth 曲线，无 overshoot

### 需求:卡片列表全量替换时必须整页重挂载，禁止触发 layout 位移竞态

当卡片列表（搜索/收藏页面的 ComicCard 网格）发生**整页全量替换**（翻页、新搜索、切换来源、切换搜索模式、切换收藏来源、切换 tag 筛选等导致整批卡片同时被新内容替换的场景）时，列表容器**必须**以「内容上下文 + 页码/筛选」派生的稳定 `key` 驱动整页重挂载，**禁止**复用旧 DOM 触发 framer-motion `layout` 动画的 mount 测量竞态。

「整页重挂载」指：grid 容器的 `key` 在「同一批内容」内保持稳定（不随无关 re-render 变化），在「不同批内容」之间必然变化，使 React 重建整个卡片子树。

此需求与「ComicCard 网格必须使用 framer-motion layout 动画实现进出场与位置过渡」并存且不冲突：layout 动画用于 `cardStyle` 切换的位置过渡与局部增删（单卡片移除）的剩余卡片归位；而整页替换走 fresh mount 的 stagger 进场动画（opacity + y），不走 layout 校正。

#### 场景:cover 模式翻页时卡片无飞入位移

- **当** 用户在「标题+封面」(cover) 显示模式下从第 N 页翻到第 N+1 页（或任意翻页、跳页）
- **那么** 新一页的所有卡片只以 stagger 进场动画出现（opacity 0→1 + y 8px→0），**禁止**任何卡片从左上角或偏离最终位置的远处 transform 飞入

#### 场景:新搜索/换来源/换模式时卡片无飞入位移

- **当** 用户执行新搜索、切换来源（source）、切换搜索模式（keyword/tag/random）
- **那么** 结果列表的所有卡片只走 stagger 进场动画，**禁止** layout 位移飞入

#### 场景:同一批内容 re-render 时 key 稳定不重挂载

- **当** 同一批搜索结果因无关状态变化（如选中态切换、下载进度更新、hover）触发 re-render
- **那么** grid 容器 `key` 保持不变，卡片**禁止**重挂载、**禁止**重播进出场动画

#### 场景:cardStyle 切换时 layout 位置过渡仍生效

- **当** 用户在 cover 与 detailed 卡片样式之间切换（同一批内容，key 不变）
- **那么** 卡片位置仍用 `layout` 动画平滑过渡（从 grid 跳变到 flex 等），**禁止**因整页重挂载而丢失该过渡

#### 场景:局部增删时剩余卡片仍 layout 归位

- **当** 单张卡片从列表移除（取消收藏、加入黑名单），其余卡片仍在同一批内容内
- **那么** 移除的卡片缩小淡出，剩余卡片仍用 `layout` 动画平滑归位，**禁止**因整页重挂载而丢失归位过渡

#### 场景:收藏列表切换来源/翻页/筛选时无飞入位移

- **当** 用户在收藏页面切换收藏来源、翻页、切换 tag 筛选（导致整批替换）
- **那么** 收藏列表卡片只走 stagger 进场动画，**禁止** layout 位移飞入

#### 场景:reduced-motion 下整页替换仍退化为纯 opacity

- **当** 用户启用「减少动画」且发生整页全量替换
- **那么** 卡片进出场仍退化为纯 opacity 淡入淡出（无 y 位移、无 scale、无 layout 重排动画），与现有 reduced-motion 退化路径一致

