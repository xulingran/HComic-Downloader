## 新增需求

### 需求：Tab 切换必须具有方向感知的过渡动画

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

### 需求：动画时长和曲线必须统一

Tab 页面过渡必须使用 `DURATION.slower`（450ms）时长和 `smoothTransition` 曲线（cubic-bezier(0.4,0,0.2,1)），以确保与项目其他动画（翻页、卡片列表）的节奏一致。禁止使用 spring 曲线（避免 overshoot）。

#### 场景：过渡播放过程中
- **当** 用户切换 tab
- **那么** 过渡动画在 450ms 内完成，使用 ease-out 曲线，无 overshoot

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

### 需求：mode 必须为 "wait"

Tab 页面过渡必须使用 `<AnimatePresence mode="wait">`，确保旧页面的 exit 动画完全结束后新页面的 enter 动画才开始，避免两个页面同时可见造成的视觉重叠。

#### 场景：在过渡期间无内容重叠
- **当** 用户在 tab A 并切换到 tab B
- **那么** 在过渡期间，不会出现 tab A 和 tab B 的内容同时可见的情况
