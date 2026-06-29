## 1. 移除 preload 拖动机制

- [x] 1.1 删除 `electron/login-preload.ts` 中的 `bindDrag` 函数（约 380–429 行整段）
- [x] 1.2 删除 `DRAG_THRESHOLD_PX` 常量定义（约 91–92 行）
- [x] 1.3 删除 `renderDot()` 内的 `bindDrag(host, dot)` 调用（约 196 行），保留 `dot.addEventListener('click', ...)` 展开逻辑
- [x] 1.4 删除 `renderCard()` 内的 `bindDrag(host, head)` 调用（约 227 行）
- [x] 1.5 从 `OVERLAY_STYLES` 移除 `.head { cursor: grab }` 与 `.head:active { cursor: grabbing }` 两条规则（约 147–148 行），`.head` 回退默认光标

## 2. 更新测试

- [x] 2.1 重写 `tests/unit/preload/login-preload.test.ts` 中 `describe('login-preload: overlay drag')` 的第一个用例：从「拖动改变 host.left」改为「指针拖动后 host 定位不变（top/right 保持初始值，left 为空）」
- [x] 2.2 重写第二个用例：从「阈值内 click 展开」简化为「点击圆点直接展开（无拖动吞咽）」，并补一个断言确认不存在 `DRAG_THRESHOLD_PX` 相关的 pointer 吞咽行为
- [x] 2.3 将该 describe 块标题从 `overlay drag` 改为 `overlay fixed (undraggable)` 以反映新行为

## 3. 验证

- [x] 3.1 运行 `npm test -- login-preload` 确认重写的用例通过，且状态机 / 挑战模式用例无回归
- [x] 3.2 运行 `npx tsc --noEmit` 确认无类型错误（删除函数后无悬空引用）
- [x] 3.3 运行 `npm run lint` 确认无未使用变量 / 无未引用导入告警
- [x] 3.4 手动验证：`npm run dev` → 打开弹窗登录 / 人机验证弹窗，确认圆点与卡片固定在右上角不可拖动，点击圆点正常展开、✕ 正常收起
