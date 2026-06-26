## 1. Toast 基础设施扩展（底层先行）

- [x] 1.1 扩展 `src/stores/useToastStore.ts`：`ToastData` 增加 `actionLabel?` / `onAction?` / `persistent?` 字段；`show(message, type?, options?)` 签名支持新选项；`error/success/info` 快捷方法透传 options；保持现有无 options 调用向后兼容
- [x] 1.2 修改 `src/components/common/Toaster.tsx`：当 `toast.persistent === true` 时不启动 4 秒自动消失定时器；非持久 Toast 行为不变
- [x] 1.3 修改 `src/components/common/Toast.tsx`：从 store 取 `actionLabel` / `onAction`（若 Toaster 转发）；确认按钮渲染与 onAction 回调已支持（组件原生已支持，仅需打通 store → Toaster → Toast 的数据传递）
- [x] 1.4 为 Toast 扩展编写测试：persistent Toast 不自动消失、带 action 的 Toast 渲染按钮且点击触发回调、无 options 的旧调用零回归

## 2. 失败页聚合 hook

- [x] 2.1 新增 `src/hooks/useFailedPages.ts`：维护 `Set<number>` 失败索引集合；提供 `markFailed(idx)` / `markLoaded(idx)` / `clearAll()` / `retryAll()`（提升 retryGen）/ `failedCount`（或集合本身）/ `retryGen`；retryAll 仅自增 retryGen，由叶子组件 effect 响应
- [x] 2.2 为 useFailedPages 编写单元测试：markFailed/markLoaded 增删、retryAll 自增 retryGen、clearAll 清空集合与 retryGen、重复 markFailed 幂等

## 3. 叶子组件接口改造（失败上报 + 受控重试）

- [x] 3.1 修改 `src/components/ReaderPage.tsx`：新增 props `onFailed?: (idx) => void` / `onLoaded?: (idx) => void` / `retryGen?: number`；IPC 失败与 `<img onError>` 两条失败路径都调用 onFailed；成功 setDataUri 时调用 onLoaded；新增 effect 监听 retryGen 变化，变化时若当前处于 error 态则重置 error/dataUri/retryTick 触发重载
- [x] 3.2 修改 `src/components/PageFlipView.tsx` 的 `FlipPage`：新增 `onFailed?` / `onLoaded?` / `retryGen?` props；失败时调用 onFailed，成功 setDataUri 时调用 onLoaded；新增 retryGen 监听 effect；并在失败占位处渲染单页"重试"按钮（触发本地 retryTick，不污染父 retryGen）
- [x] 3.3 验证 ReaderPage/FlipPage 在未传入新 props 时（默认 undefined）行为与改造前完全一致，本地单页重试仍可用

## 4. ComicReaderModal 装配

- [x] 4.1 在 `ComicReaderModal` 挂载 `useFailedPages`，向所有 `<ReaderPage>` 与 `<PageFlipView>` 传入 `onFailed` / `onLoaded` / `retryGen`
- [x] 4.2 实现阈值 Toast 逻辑：用 `useEffect` 监听 failedCount；当从 ≤ 3 跨越到 > 3 时，以 persistent + action("全部重试") 显示失败 Toast，文案"N 页加载失败"；当从 > 3 回落 ≤ 3 时调用 dismiss 隐藏
- [x] 4.3 实现"全部重试"按钮：点击调用 `retryAll()`（自增 retryGen）；并按 design 决策 3 的反馈策略，监听 failedCount 从 > 0 变 0 时将 Toast 切为 success（"已恢复全部页面"）、取消 persistent 让其自动消失
- [x] 4.4 在阅读器关闭/章节切换时（现有 reset 流程）同步 clearAll 失败集合与重置 Toast，避免残留

## 5. 集成测试与回归验证

- [x] 5.1 编写集成测试：模拟 > 3 页失败 → 常驻 Toast 出现且带"全部重试"按钮 → 点击后失败页重载 → 全部恢复后 Toast 切 success 并自动消失
- [x] 5.2 编写回归测试：失败 ≤ 3 时不弹常驻 Toast（仅单页本地重试）；已成功页在 retryAll 时不重新请求
- [x] 5.3 运行完整验证流程：`pytest`、`npx tsc --noEmit`、`npm test`、`npm run lint:py`、`black --check .`、`npm run lint` 全部通过
