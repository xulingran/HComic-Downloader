## 为什么

弹窗登录 / 人机验证弹窗右上角的「完成」浮标（圆点 `✓` 与展开卡片）当前支持拖动。实际使用中用户拖动浮标后，叠层会偏离默认右上角锚点（`top:12px;right:12px`），后续切换状态时卡片在偏移位置展开，视觉上产生「错位」，反而干扰了登录/验证流程。用户明确要求该组件**不可拖动**，固定在右上角。

## 变更内容

- **移除** `electron/login-preload.ts` 中的拖动机制：`bindDrag` 函数、`DRAG_THRESHOLD_PX` 常量、`renderDot()` / `renderCard()` 内对 `bindDrag` 的调用，以及点击吞咽逻辑。
- **移除** 卡片顶栏 `.head` 的 `cursor: grab / grabbing` 视觉提示（不可拖动时该光标具有误导性）。
- 收起态圆点的 `click → expanded` 转换不再被拖动吞咽逻辑干扰，点击直接展开。
- 叠层 host 永久固定在 `position:fixed; top:12px; right:12px`，不再随指针移动。
- **修改** `login-overlay` 规范：把「必须可拖动」需求替换为「必须固定不可拖动」。

## 功能 (Capabilities)

### 新增功能
<!-- 无 -->

### 修改功能
- `login-overlay`: 将「浮标叠层必须可拖动」需求替换为「浮标叠层必须固定不可拖动」——移除拖动相关需求与场景，新增「叠层固定在右上角不可移动」需求。

## 影响

- **代码**：`electron/login-preload.ts`（移除 `bindDrag`、`DRAG_THRESHOLD_PX`、相关样式与调用点）。
- **测试**：`tests/unit/preload/login-preload.test.ts` 中的 `describe('login-preload: overlay drag')` 两个用例断言拖动行为，需重写为「固定不可移动」断言；其余状态机 / 挑战模式用例不受影响（它们用 `.click()`，不依赖 pointer 拖动序列）。
- **规范**：`openspec/specs/login-overlay/spec.md`（替换拖动需求）。
- **行为**：浮标不再可被指针拖动；切换状态时始终在右上角展开，不再「错位」。无 API / 依赖 / 持久化变更（拖动位置本就只在当前文档生命周期内、不持久化）。
