## 为什么

用户在"下载为专辑"命名框等弹窗里拖选文字准备删除时，若不小心把鼠标拖到对话框外面再松手，弹窗会被意外关闭——已选中的文字连同输入的上下文全部丢失。

根因是经典的"遮罩 `onClick` 关闭"陷阱：当前 6 处对话框都用 `<div onClick={onClose}>` 外层遮罩 + `<div onClick={(e) => e.stopPropagation()}>` 内层内容的结构。但 `click` 事件按"mousedown 与 mouseup 的共同祖先"派发，当 mousedown 落在内层输入框、mouseup 落在外层遮罩时，浏览器认为点击目标就是遮罩，触发 `onClose`——`stopPropagation` 救不了，因为 mouseup 已经不在内层。

## 变更内容

1. **新建共享 `Modal` 组件**（`src/components/common/Modal.tsx`）——统一封装"遮罩 + 内容居中"结构，内部用 `mousedown` 起点判定（方案 A）实现"安全的遮罩点击关闭"：只有 mousedown 和 click 都落在遮罩本身才关闭，从根源上杜绝拖选逸出误关。组件同时内置淡入淡出动画（复用 `useModalAnimation`）、ESC 关闭、`closeOnOverlayClick` 开关、`zIndex` 等可配置项。
2. **迁移 7 处对话框**全部改用 `Modal`：`AlbumNameDialog`、`ChapterDownloadDialog`、`PageJumpDialog`、`TagDialog`、`UpdateDialog`、`MigrationDialog`、`ComicInfoDrawer` 内的确认子框。迁移后各组件删除自己的遮罩 `onClick` 与内层 `stopPropagation`，统一由 `Modal` 负责。
3. **`AlbumNameDialog` 删除 `wasOpen` 渲染期同步逻辑**——`Modal` 接管 mount/unmount 后，弹窗关闭即卸载，下次打开重新挂载，`useState(defaultName)` 自然拿到最新值，不再需要那段注释很用心的 prop 同步代码。
4. **`MigrationDialog` 统一为可点击遮罩关闭**——它是唯一不能点遮罩关闭的对话框，迁移后用 `closeOnOverlayClick={!(phase === 'executing' && isActive)}`，迁移执行中禁用关闭（避免误触中断），其余阶段统一支持。

## 方案 A 核心逻辑

```
mousedown 判定起点
┌──────────────────────────────────────────────┐
│  mousedown.target === overlay 本身？          │
│  ├─ 是 → 记录 mouseDownOnOverlay = true      │
│  └─ 否（落在内层/输入框）→ 记录 false         │
│                                                │
│  click 派发时：                                │
│  closeOnOverlayClick                          │
│    && mouseDownOnOverlay                      │
│    && click.target === overlay 本身           │
│  → 触发 onClose                                │
└──────────────────────────────────────────────┘

拖选逸出场景（bug 现状）：
  mousedown 在输入框 → mouseDownOnOverlay = false
  鼠标拖到遮罩 → mouseup
  click 派发 → mouseDownOnOverlay=false → 不关闭 ✓
```

## 功能 (Capabilities)

### 新增功能

- `modal-overlay` — 共享 `Modal` 组件：安全的遮罩点击关闭（基于 mousedown 起点）、淡入淡出动画、ESC 关闭、可配置 `closeOnOverlayClick`/`zIndex`/`ariaLabel`

### 修改功能

- `album-name-dialog` — 改用 `Modal` 承载，删除 `wasOpen` 渲染期同步逻辑（Modal 接管 mount 后不再需要）
- `chapter-download-dialog` — 改用 `Modal` 承载
- `page-jump-dialog` — 改用 `Modal` 承载
- `tag-dialog` — 改用 `Modal` 承载
- `update-dialog` — 改用 `Modal` 承载，保留遮罩点击关闭语义
- `migration-dialog` — 改用 `Modal` 承载，从"不可点击遮罩关闭"改为"执行中禁用、其余阶段可关闭"
- `comic-info-drawer` — 内部确认子框改用 `Modal` 承载

## 影响

- **受影响文件**:
  - 新增: `src/components/common/Modal.tsx`、`tests/unit/components/common/Modal.test.tsx`
  - 修改: `src/components/common/AlbumNameDialog.tsx`、`src/components/ChapterDownloadDialog.tsx`、`src/components/common/PageJumpDialog.tsx`、`src/components/TagDialog.tsx`、`src/components/UpdateDialog.tsx`、`src/components/settings/MigrationDialog.tsx`、`src/components/ComicInfoDrawer.tsx`、`tests/unit/components/common/AlbumNameDialog.test.tsx`
- **测试**: 新增 `Modal.test.tsx` 覆盖方案 A 核心行为（尤其"mousedown 在内层、click 在遮罩"不触发关闭）；`AlbumNameDialog.test.tsx` 删除"弹窗保持打开期间父组件重渲染不覆盖用户编辑"用例（底层机制改变，Modal 接管 mount 后该场景不存在）
- **对外接口**: 无 IPC 变更，纯前端组件重构
- **行为变更**: `MigrationDialog` 从"点击遮罩无反应"变为"非执行阶段可点遮罩关闭"，是统一化改进；其余对话框的遮罩关闭语义保持不变
- **不做的事**: 不重构 `ComicReaderModal`（全屏阅读器，结构不同，无遮罩区域可逸出）；不引入额外依赖
