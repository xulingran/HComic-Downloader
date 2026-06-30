## 为什么

漫画阅读器的 single / double 翻页动画当前没有按既有 `ui-animation` 规范使用 smooth 曲线，而是因 `getDirectionalPageVariants()` 缺失 `transition` 字段回退到 framer-motion 默认 spring，导致翻页时出现 overshoot、回弹和抖动感。该问题同时影响单页与双页模式，破坏了阅读器翻页应“稳稳停下”的体验。

## 变更内容

- 修复阅读器横向翻页 variants，使普通动画路径明确使用项目共享的 `smoothTransition`，禁止回退到默认 spring。
- 为普通翻页进入/退出状态加入轻微 opacity 变化，让新旧页切换更柔和。
- 保持现有方向感知逻辑、double 模式整体滑动、blank page 参与过渡、wheel/isFlipping 门控与 reduced-motion 降级行为不变。
- 补充针对翻页 variants 的回归测试，防止后续重构再次遗漏 transition。

## 功能 (Capabilities)

### 新增功能

无。

### 修改功能

- `ui-animation`: 修正“阅读器 single 与 double 模式必须使用横向滑动翻页过渡”的实现一致性；补充普通翻页路径必须显式使用 smooth transition 且可带轻微 opacity 过渡的要求。

## 影响

- `src/lib/anim.ts`: 调整 `getDirectionalPageVariants()` 的 enter/center/exit variants。
- `tests/`: 增加或扩展动画 variants 单元测试，覆盖 smooth transition 与轻微 opacity。
- 不涉及 Python 后端、Electron IPC、网络请求、下载逻辑或外部 API。
