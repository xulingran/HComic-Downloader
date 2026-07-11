## 修改需求

### 需求：Tab 切换必须具有方向感知的过渡动画

系统在用户切换 tab 时，**必须**根据导航方向播放 slide + opacity 过渡动画：向"右"导航（索引增大）时，新页面从右侧 8% 处滑入同时旧页面从原位置向左滑出；向"左"导航（索引减小）时方向相反。导航方向由目标 tab 与当前 tab 在 `TAB_ORDER` 中的索引差决定。

**实现约束（与 `page-keep-alive` 协调）**：因 keep-alive 要求页面永不卸载（见 `page-keep-alive` 规范），系统**禁止**依赖 `AnimatePresence` 的 mount/unmount 触发进出场动画，**必须**通过 framer-motion `useAnimationControls` 在 `activePage` 变化时命令式重播进出场过渡——对成为激活的页面调用进入动画、对失去激活的页面调用退出动画，两者**必须**同时播放（等效 `mode="sync"` 的连续推送效果）。

系统**必须**保证：切回已访问的存活实例时**必须**重播进入动画。**禁止**出现「切回已访问页面时无过渡、瞬间显示」的行为。（例外：首次加载与懒创建首访因 controls 绑定时序竞态白屏风险，直接可见不播进入动画，见下方「首次加载与懒创建首访必须直接可见」需求。）

#### 场景：用户点击右侧 tab
- **当** 用户当前在「搜索」tab 且点击「下载管理」tab
- **那么** 当前页面向左滑出，同时下载管理页面从右侧 8% 处滑入

#### 场景：用户点击左侧 tab
- **当** 用户当前在「关于」tab 且点击「工具箱」tab
- **那么** 当前页面向右滑出，同时工具箱页面从左侧 8% 处滑入

#### 场景：用户点击同一个 tab
- **当** 用户当前在「搜索」tab 且再次点击「搜索」tab
- **那么** 不播放任何过渡动画（方向为 0）

#### 场景：切回已访问页面必须重播进入动画
- **当** 用户从搜索页切到下载页，再切回搜索页（搜索页实例已存活、未卸载）
- **那么** 搜索页**必须**重播方向感知的进入动画（从对应方向 8% 处 slide + fade），**禁止**瞬间无动画显示

#### 场景：连续多次切换均每次播放动画
- **当** 用户在搜索页 → 下载页 → 搜索页 → 下载页之间连续切换（下载页实例已存活）
- **那么** 每一次切换**都**播放进入/退出动画，**禁止**仅首次访问时播放

### 需求：首次加载与懒创建首访必须直接可见，不播进入动画

应用首次加载（首屏）与懒创建首次访问某 tab 时，页面**必须**直接以可见态（opacity:1）渲染，**禁止**播进入动画。

**理由**：keep-alive 下页面首次 mount 时，`initial opacity:0` + `animate={controls}` 的组合存在 controls 与 motion 元素绑定的时序竞态——若 mount 后的 `controls.start()` 在绑定完成窗口外执行，元素会永久卡在 `opacity:0` 导致白屏。为消除此 P0 回归风险，首次 mount（首屏 + 懒创建首访）直接以可见态渲染，不依赖 controls.start 才可见。切换进入（切回已存活实例）的 controls 已绑定，无竞态，正常播动画。

#### 场景：应用首次启动直接显示搜索页
- **当** 用户打开应用，首次渲染搜索页面
- **那么** 搜索页面直接以可见态显示（opacity:1），无淡入动画，无白屏

#### 场景：懒创建首次访问新 tab 直接可见
- **当** 用户首次点击某未访问的 tab（如下载页实例首次创建）
- **那么** 该页面直接以可见态显示（opacity:1），无进入动画；旧页面正常播退出动画

#### 场景：切回已存活页面才播进入动画
- **当** 用户从 tab A 切到 tab B（B 已存活、非首次 mount），再切回 tab A（A 已存活）
- **那么** tab A 重播方向感知的进入动画（slide 8% + fade），不白屏

### 需求：reduced-motion 偏好必须被尊重

当用户操作系统开启了 reduced-motion 偏好时，所有 tab 过渡**必须**退化为纯 opacity crossfade（无位移、无缩放），时长压缩至 `DURATION.fast`（150ms）。

#### 场景：reduced-motion 开启时切换 tab
- **当** 用户操作系统启用了 reduced-motion 且用户切换 tab
- **那么** 页面过渡仅使用 opacity crossfade（0 ↔ 1），时长 150ms，无任何位移

#### 场景：reduced-motion 下切回已访问页面仍重播
- **当** 用户启用 reduced-motion 且切回已访问页面（实例存活）
- **那么** 该页面以纯 opacity crossfade 重播进入动画，**禁止**瞬间无动画显示

### 需求：程序化跳转必须触发动画

通过 `onNavigateToSettings`（SearchPage/FavouritesPage 调用）、`pendingSearch`（ComicInfoDrawer 调用）发起的程序化页面跳转，**必须**同样触发方向感知的过渡动画，方向由索引差自然决定。

#### 场景：通过 onNavigateToSettings 跳转
- **当** 用户点击搜索页面的「跳到设置」按钮
- **那么** 搜索页面滑出，设置页面从对应方向滑入

#### 场景：通过 pendingSearch 自动跳转
- **当** 用户在漫画信息抽屉中点击搜索漫画名
- **那么** 当前页面滑出，搜索页面从对应方向滑入

### 需求：所有 overlay 组件必须不受 tab 过渡影响

Toast、Toaster、ComicInfoDrawer、ComicReaderModal、FatalBanner、UpdateDialog 这些 overlay 组件在 tab 过渡期间**必须**保持其现有行为，**禁止**跟随页面一起滑动或消失。

#### 场景：overlay 在 tab 过渡期间保持稳定
- **当** 用户有一个打开的 ComicInfoDrawer 时切换 tab
- **那么** ComicInfoDrawer 保持其现有位置和状态，不随页面过渡移动

### 需求：Tab 过渡必须在 keep-alive 下达到 sync 推送效果

系统**必须**在 keep-alive（页面永不卸载）的前提下，通过 `useAnimationControls` 同步驱动新旧页面的进出场动画，达到与 `AnimatePresence mode="sync"` 等效的连续推送视觉效果：exit 和 enter 同时播放，旧页滑出的同时新页滑入。**禁止**使用 `mode="wait"`（会导致过渡延迟感），也**禁止**因 keep-alive 而放弃 sync 语义（导致切回时无动画或仅新页单独动画）。

退出页的 `display:none` **必须**延迟到其退出动画播放完毕后才应用，**禁止**在退出动画开始前就把退出页设为 `display:none`（会导致退出动画不可见）。

#### 场景：过渡期间新旧页面同时可见
- **当** 用户在 tab A 并切换到 tab B
- **那么** tab A 的退出动画与 tab B 的进入动画同时播放（等效 `mode="sync"`），在过渡中段约 150ms 窗口内两页共存于视口，形成连续推送效果；退出页的退出动画完成后才被 `display:none` 隐藏

#### 场景：退出页 display 切换延迟到动画完成
- **当** 用户从 tab A 切到 tab B，tab A 开始播放退出动画
- **那么** tab A 在退出动画期间保持 `display:block`（退出动画可见），退出动画完成后才变为 `display:none`

### 需求：Tab 动画时长和曲线必须统一

Tab 页面过渡**必须**使用 `DURATION.slow`（300ms）时长和 `smoothTransition` 曲线（cubic-bezier(0.4,0,0.2,1)），以确保与项目其他动画（翻页、卡片列表）的节奏一致。**禁止**使用 spring 曲线（避免 overshoot）。

#### 场景：过渡播放过程中
- **当** 用户切换 tab
- **那么** 过渡动画在 300ms 内完成，使用 smooth 曲线，无 overshoot

## 移除需求

### 需求：mode 必须为 "sync"

**Reason**: 该需求原先要求"Tab 页面过渡使用 `<AnimatePresence mode="sync">`"，但与 `page-keep-alive` 规范（页面永不卸载）结构冲突——AnimatePresence 需要 mount/unmount 才能触发 exit/enter，而 keep-alive 禁止卸载。实现为调和此冲突改用 `useAnimationControls` 命令式驱动，sync 的视觉效果（新旧页同时滑入滑出）由上方「Tab 过渡必须在 keep-alive 下达到 sync 推送效果」需求承载。

**Migration**: 实现侧不再使用 `<AnimatePresence>` 包裹 tab 页面容器；改为每个存活页面持有独立 `AnimationControls`，在 `activePage` 变化时 `start()` 进出场动画。该改动不影响任何外部 API 或配置。
