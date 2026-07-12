## 为什么

漫画阅读器目前在连续滚动、单页和双页模式之间直接替换渲染分支，画面会瞬间重排；在线阅读器还会在切入双页模式后通过 effect 二次修正页码，而本地阅读器缺少同样逻辑。现有共享图片缓存和 framer-motion 动画令牌已经具备基础条件，现在需要把模式切换定义为可感知、页码稳定且两套阅读器一致的过渡。

## 变更内容

- 为连续滚动与分页模式之间增加短时 fade-through 过渡，目标视图完成页码定位后再显示，避免首帧跳页和新旧内容重影。
- 为单页与双页模式之间增加保持当前页视觉锚点的布局重排动画，而不是复用表示内容前进/后退的横向翻页动画。
- 将目标页或双页起始页的计算移到模式切换提交之前，使页码修正与模式更新原子发生，并统一在线与本地阅读器行为。
- 在过渡期间协调页追踪、滚轮、拖拽和平移动作；快速连续选择模式时以最后一次意图为准，禁止堆积过渡层。
- 为模式选择控件增加与内容状态同步的活动指示过渡，并为 `prefers-reduced-motion` 提供无位移降级。
- 保持共享图片缓存跨模式不清空，禁止模式动画触发当前页重复加载。
- 持久化并在在线/本地阅读器之间同步最后选择的显示模式，重新打开阅读器时恢复该模式。
- 保持普通翻页动画与模式重排动画互斥；双页模式按阅读区高度最大化显示且两页中缝为零。

## 功能 (Capabilities)

### 新增功能

<!-- 无。 -->

### 修改功能

- `ui-animation`: 新增阅读器显示模式切换的语义化动画、快速切换、输入门控和 reduced-motion 要求。
- `local-comic-reader`: 明确本地阅读器必须与在线阅读器共享模式过渡、页码锚定和缓存复用行为。

## 影响

- React 阅读器容器：`src/components/ComicReaderModal.tsx`、`src/components/library/LocalLibraryReaderModal.tsx`。
- 共享阅读器外壳和分页视图：`src/components/common/ReaderShell.tsx`、`src/components/PageFlipView.tsx`。
- 阅读设置、进度导航与页追踪：`src/hooks/useReaderSettings.ts`、`src/hooks/useReaderProgressNavigation.ts`、`src/hooks/usePageTracking.ts`。
- 共享动画令牌：`src/lib/anim.ts`。
- 前端组件、Hook、动画变体和缓存回归测试；不涉及 Python、Electron IPC、数据格式或新增依赖。
