## 1. 挑战识别与快照解析

- [x] 1.1 将 JM challenge 标记拆分为强标记和弱标记，避免仅因 `captcha` 文本误判已渲染收藏夹页面
- [x] 1.2 在 Electron challenge 快照捕获中识别收藏夹内容，并允许含弱 challenge 文本的正常收藏夹快照继续恢复
- [x] 1.3 在 Python JM 快照解析中同步弱 challenge 判定逻辑，确保主进程传入的合格快照不会被后端再次误拒
- [x] 1.4 添加 Electron 与 Python 回归测试，覆盖含 `captcha` 残留文本的已渲染收藏夹页面

## 2. 可见验证窗口自动完成

- [x] 2.1 在 challenge 模式窗口加载完成后自动探测当前页面是否已是可信收藏夹页面
- [x] 2.2 当页面已显示收藏夹内容时自动触发快照捕获、Cookie/UA 同步和成功收尾
- [x] 2.3 保留真正 challenge 页面下的手动验证与取消流程
- [x] 2.4 添加单元测试覆盖“页面已直接显示收藏夹时自动完成恢复”

## 3. 静默快照恢复模式

- [x] 3.1 在 JM 快照兜底解析成功后记录静默快照恢复可用状态
- [x] 3.2 保存最近一次可信收藏夹快照 URL，并根据目标页码派生后续收藏夹 URL
- [x] 3.3 实现隐藏 BrowserWindow 快照捕获入口，使用现有 URL 校验、CSP 放宽和 Session 上下文
- [x] 3.4 在静默模式下优先通过隐藏快照和 `parse_jm_favourites_snapshot` 获取结果，成功时不打开可见验证窗口
- [x] 3.5 静默快照失败时回退到原 Python `get_favourites` 和可见交互恢复流程

## 4. 主进程 IPC 集成

- [x] 4.1 在 `python:get-favourites` handler 中检测 JM、交互请求与静默快照模式
- [x] 4.2 静默模式可用时，在调用 Python `get_favourites` 前先尝试 `recoverJmFavouritesSilently`
- [x] 4.3 确保非交互后台刷新/预加载不打开隐藏或可见 BrowserWindow
- [x] 4.4 添加主进程单元测试，验证静默模式下不会先调用 Python `get_favourites`

## 5. 验证

- [x] 5.1 运行 TypeScript 类型检查：`npx tsc --noEmit`
- [x] 5.2 运行相关 Vitest：`npm test -- tests/unit/main/main.test.ts tests/unit/main/jm-challenge-recovery.test.ts tests/unit/main/login-window.test.ts`
- [x] 5.3 运行相关 Python 测试：`pytest tests/test_jm_favourites.py -q`
- [x] 5.4 运行 Python lint/format 检查：`npm run lint:py`、`black --check sources/jm/parser.py tests/test_jm_favourites.py`
- [x] 5.5 运行 TypeScript lint：`npm run lint -- --quiet`
