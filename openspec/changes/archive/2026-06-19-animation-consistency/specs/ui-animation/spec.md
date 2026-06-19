## 新增需求

> 本增量向 `ui-animation` capability 新增 4 个容器级弹窗的进出场行为契约。

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

## 移除需求

### 需求: presence hook 必须在 reduced-motion 下跳过过渡

> 变更 2 把所有弹窗迁移到 framer-motion AnimatePresence 后，`usePresenceAnimation` 与 `useModalAnimation` 两个 hook 已无调用方，本需求由更上层的「所有容器级弹窗必须使用 framer-motion AnimatePresence」与「reduced-motion 全局兜底」共同覆盖。
