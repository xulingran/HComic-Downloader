## 修改需求

### 需求:所有容器级弹窗必须使用 framer-motion AnimatePresence 驱动进出场

系统**必须**用 framer-motion 的 `AnimatePresence` 替代手动 mounted/visible state 管理，让退出动画由框架自动调度，所有弹窗共享 `src/lib/anim.ts` 中的 variants，曲线与时长由令牌统一。所有同构的右侧详情抽屉（含搜索/收藏的 `ComicInfoDrawer` 与本地漫画库的 `LibraryAssetDetailDrawer`）**必须**复用同一组 `drawerPresenceVariants`（面板）与 `overlayPresenceVariants`（遮罩）令牌，**禁止**任一抽屉硬挂载/卸载或自定义滑入时长与曲线。在线漫画预览器和本地漫画阅读器**必须**通过共享阅读器外壳的 `AnimatePresence` 驱动完整进出场，关闭时**禁止**在退出完成前清空最后有效内容或直接卸载。

#### 场景:Modal 进出场用 scale + opacity spring

- **当** 用户打开或关闭一个 Modal
- **那么** 内层用 `modalPresenceVariants`（opacity 0→1、scale 0.95→1，spring 曲线），退出时反向播放

#### 场景:ComicInfoDrawer 从右滑入

- **当** 用户打开详情抽屉
- **那么** 抽屉用 `drawerPresenceVariants`（x 100%→0，spring 曲线），退出时向右滑出

#### 场景:LibraryAssetDetailDrawer 从右滑入并与 ComicInfoDrawer 一致

- **当** 用户在本地漫画库点击资产卡片打开资产详情抽屉
- **那么** 面板用 `drawerPresenceVariants`（x 100%→0，spring 曲线）从右滑入、遮罩用 `overlayPresenceVariants`（opacity 0→1）淡入，与 `ComicInfoDrawer` 的进出场视觉完全一致；关闭时反向播放退场动画，**禁止**瞬间挂载/卸载

#### 场景:LibraryAssetDetailDrawer 在 reduced-motion 下退化为纯淡入淡出

- **当** 用户偏好「减少动画」且打开/关闭资产详情抽屉
- **那么** 面板通过 `reduceSafe(drawerPresenceVariants)` 退化为纯 opacity 淡入淡出（无 x 位移），遮罩保持 opacity 淡入淡出，与全项目双层降级策略一致

#### 场景:在线漫画预览器关闭时完整退场

- **当** 用户通过关闭按钮、Escape 或遮罩关闭在线漫画预览器
- **那么** 阅读器主体必须使用 `readerPresenceVariants` 从当前位置向下滑出，遮罩必须同步淡出，最后有效漫画内容必须保留到退出动画完成，之后才允许卸载和清理

#### 场景:本地漫画阅读器关闭时完整退场

- **当** 用户关闭本地漫画阅读器
- **那么** 阅读器必须采用与在线预览相同的主体下滑和遮罩淡出动画，最后有效资产内容必须保留到退出完成，禁止出现空白退场帧或瞬间消失

#### 场景:阅读器关闭请求立即停止交互

- **当** 任一阅读器已经开始退出动画
- **那么** 系统必须立即停止键盘、滚轮、指针、滑块和显示模式输入并忽略重复关闭请求，禁止退场期间继续翻页或启动新请求

#### 场景:过期退出回调不影响新会话

- **当** 旧阅读器的退出完成回调到达前用户已打开另一部漫画
- **那么** 旧回调禁止清空新漫画内容、关闭新阅读器或重置新会话状态

#### 场景:阅读器在 reduced-motion 下关闭

- **当** 用户启用「减少动画」并关闭在线或本地阅读器
- **那么** 阅读器主体必须移除纵向位移并退化为短时纯透明度退场或由全局策略近乎瞬时完成，遮罩同步淡出

#### 场景:Toast 从上方滑入

- **当** Toast 显示
- **那么** Toast 用 `toastPresenceVariants`（y -1rem→0 + opacity，spring 曲线），退出时反向
