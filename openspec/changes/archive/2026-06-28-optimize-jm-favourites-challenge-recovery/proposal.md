## 为什么

JM 收藏夹在 Python 后端直连请求时会持续命中站点反爬挑战，但同一 Electron BrowserWindow 往往已经能直接渲染收藏夹页面。当前恢复流程虽然可以通过一次可见验证窗口和浏览器 DOM 快照兜底拿到数据，但后续翻页仍可能先触发 Python 直连失败，产生重复挑战日志、额外延迟和不必要的隐藏/可见窗口恢复尝试。

## 变更内容

- 优化 JM 收藏夹反爬恢复流程：首次可见验证和快照兜底成功后，后续 JM 收藏夹翻页可直接进入静默浏览器快照恢复路径。
- 在静默模式下，主进程根据最近一次可信 JM 收藏夹快照 URL 构造目标页 URL，使用隐藏 BrowserWindow 获取 DOM 快照，并调用 Python `parse_jm_favourites_snapshot` 解析，避免先调用 Python `get_favourites` 直连请求。
- 改进 challenge 页面识别：将 `captcha` 作为弱标记，仅在页面没有收藏夹内容时判定为未完成验证，避免正常收藏夹页面因残留脚本变量被误判。
- 增加 challenge 窗口自动完成能力：如果可见验证窗口加载后已直接显示收藏夹页面，则自动抓取快照并完成恢复，减少用户手动点击。
- 保持安全约束：所有快照 URL 仍必须是 HTTPS、可信 JM 域名、收藏夹路径；Cookie/UA/HTML 不进入 React renderer；隐藏快照失败时回退到原有可见恢复或错误处理。

## 功能 (Capabilities)

### 新增功能

### 修改功能
- `jm-interactive-challenge-recovery`: 增加验证后静默快照恢复、自动完成验证窗口、弱 challenge 标记判断等用户可见恢复行为。
- `jm-challenge-recovery`: 增加正常收藏夹内容优先于弱 challenge 文本的判定，避免浏览器快照被误判为仍在人机验证页。

## 影响

- Electron 主进程：`electron/jm-challenge-recovery.ts`、`electron/login-window.ts`、`electron/main.ts`
- Python JM 解析：`sources/jm/parser.py`
- 测试：`tests/unit/main/jm-challenge-recovery.test.ts`、`tests/unit/main/login-window.test.ts`、`tests/unit/main/main.test.ts`、`tests/test_jm_favourites.py`
- IPC 行为：不新增公开 IPC 通道；`python:get-favourites` 在 JM 静默快照模式下可直接返回快照解析结果。
