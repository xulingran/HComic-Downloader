## 1. 阅读器关闭生命周期

- [x] 1.1 扩展在线阅读器 store，将可见状态、最后有效漫画数据和最终清理分离，并让关闭与 finalize 操作具备会话标识校验和幂等性
- [x] 1.2 扩展本地阅读器 store，以相同模型保留退场资产、维护 `justClosedAssetId` 刷新契约，并防止旧退出回调清理新会话
- [x] 1.3 调整在线和本地阅读器的关闭副作用，在请求关闭时立即停止输入、失效异步工作并 flush 本地进度，在退出完成后才释放渲染数据与缓存

## 2. 共享关闭动画

- [x] 2.1 在 `ReaderShell` 中使用 `AnimatePresence` 条件渲染共享 fixed 容器，为遮罩和阅读器主体接入显式 exit variants 与退出完成回调
- [x] 2.2 接通在线 `ComicReaderModal`、本地 `LocalLibraryReaderModal` 与 App 挂载层的关闭完成事件，确保关闭按钮、Escape、遮罩和错误/空状态入口统一走两阶段关闭
- [x] 2.3 验证 closing 状态下所有阅读器输入被门控、重复关闭无效，且 reduced-motion 复用集中 variants 退化为无位移淡出

## 3. 自动化验证

- [x] 3.1 增加共享外壳组件测试，验证正常与 reduced-motion 路径中退出完成前节点保留、完成后卸载以及遮罩/主体 exit 状态
- [x] 3.2 增加在线阅读器 store/集成测试，覆盖所有关闭入口、重复关闭、关闭期间打开新漫画及过期完成回调
- [x] 3.3 增加本地阅读器测试，验证关闭请求即时 flush 当前进度、退出期间画面保留、完成后清理与漫画库刷新契约
- [x] 3.4 运行相关 Vitest 测试、`npx tsc --noEmit`、`npm run lint` 和 `npm run lint:test-quality`，修复本变更引入的回归
