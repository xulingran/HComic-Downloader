## 为什么

漫画详情抽屉中的标签是用户判断内容和继续检索的重要信息。当前超过上限后折叠标签会隐藏部分信息并增加一次额外交互，因此应直接展示完整标签列表。

## 变更内容

- 漫画详情抽屉中的标签列表不再按数量截断，始终展示当前漫画的全部标签。
- 移除 drawer 标签区域的“+N 展开”和“收起”控件，以及仅为折叠状态服务的交互状态。
- 保持标签点击搜索、推荐/屏蔽状态、来源能力门控、详情补全加载/失败/重试等现有行为不变。
- 在线阅读器尾页继续完整展示标签，行为不变。

## 功能 (Capabilities)

### 新增功能

无。

### 修改功能

- `comic-detail-drawer-layout`: 将详情抽屉的大量标签展示规则从渐进展开改为始终完整展示，并取消折叠/展开控件。

## 影响

- 前端详情组件：`src/components/ComicInfoDrawer.tsx`
- 前端组件测试：`tests/unit/components/ComicInfoDrawer.test.tsx`
- 现有 OpenSpec 能力：`openspec/specs/comic-detail-drawer-layout/spec.md`
- 不涉及 Python 后端、IPC 契约、网络请求、依赖项或数据迁移。
