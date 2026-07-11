## 修改需求

### 需求: 所有容器级弹窗必须使用 framer-motion AnimatePresence 驱动进出场

系统**必须**用 framer-motion 的 `AnimatePresence` 替代手动 mounted/visible state 管理，让退出动画由框架自动调度，所有弹窗共享 `src/lib/anim.ts` 中的 variants，曲线与时长由令牌统一。所有同构的右侧详情抽屉（含搜索/收藏的 `ComicInfoDrawer` 与本地漫画库的 `LibraryAssetDetailDrawer`）**必须**复用同一组 `drawerPresenceVariants`（面板）与 `overlayPresenceVariants`（遮罩）令牌，**禁止**任一抽屉硬挂载/卸载或自定义滑入时长与曲线。

#### 场景: Modal 进出场用 scale + opacity spring

- **当** 用户打开或关闭一个 Modal
- **那么** 内层用 `modalPresenceVariants`（opacity 0→1、scale 0.95→1，spring 曲线），退出时反向播放

#### 场景: ComicInfoDrawer 从右滑入

- **当** 用户打开详情抽屉
- **那么** 抽屉用 `drawerPresenceVariants`（x 100%→0，spring 曲线），退出时向右滑出

#### 场景: LibraryAssetDetailDrawer 从右滑入并与 ComicInfoDrawer 一致

- **当** 用户在本地漫画库点击资产卡片打开资产详情抽屉
- **那么** 面板用 `drawerPresenceVariants`（x 100%→0，spring 曲线）从右滑入、遮罩用 `overlayPresenceVariants`（opacity 0→1）淡入，与 `ComicInfoDrawer` 的进出场视觉完全一致；关闭时反向播放退场动画，**禁止**瞬间挂载/卸载

#### 场景: LibraryAssetDetailDrawer 在 reduced-motion 下退化为纯淡入淡出

- **当** 用户偏好「减少动画」且打开/关闭资产详情抽屉
- **那么** 面板通过 `reduceSafe(drawerPresenceVariants)` 退化为纯 opacity 淡入淡出（无 x 位移），遮罩保持 opacity 淡入淡出，与全项目双层降级策略一致

#### 场景: ComicReaderModal 从下滑入

- **当** 用户打开阅读器
- **那么** 阅读器用 `readerPresenceVariants`（y 100%→0，spring 曲线）；退出时整组件立即卸载（全屏接管场景的有意妥协，无 exit 动画）

#### 场景: Toast 从上方滑入

- **当** Toast 显示
- **那么** Toast 用 `toastPresenceVariants`（y -1rem→0 + opacity，spring 曲线），退出时反向
