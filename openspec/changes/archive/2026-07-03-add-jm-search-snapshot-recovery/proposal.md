## 为什么

JM 搜索挑战恢复在验证窗口"成功"后仍报"人机验证后仍无法获取数据"。根因有二：

1. **TLS 指纹不匹配**：Python `curl_cffi` 用 `chrome136` 模拟 TLS 指纹，但 Electron 42 运行 Chromium 142。Cloudflare `cf_clearance` Cookie 绑定 TLS 指纹，跨进程复用时被拒，Python 重试仍被挑战。日志中 `verify_auth returned valid=false` 即为直接证据。

2. **搜索无快照兜底**：收藏夹恢复在 Python 重试仍被挑战时，把验证窗口已捕获的 DOM HTML 交给 Python 解析（`parse_jm_favourites_snapshot`），完全绕过 Python HTTP 请求。搜索恢复没有对称的快照兜底（`jm-challenge-recovery.ts:242` 注释明确写了"搜索无 parse_jm_search_snapshot 入口"），一旦 Python 重试失败即直接报错。

## 变更内容

- 将 `curl_cffi` 的 `IMPERSONATE_BROWSER` 从 `chrome136` 对齐到 `chrome142`（匹配 Electron 42 / Chromium 142），同步更新 `HEADERS` 中的 `User-Agent` 和 `Sec-Ch-Ua` 版本号。
- 消除 `cover_mixin.py` 和 `title_resolver.py` 中硬编码的 `chrome136` 字面量，统一引用 `IMPERSONATE_BROWSER`。
- Python 新增 `parse_jm_search_snapshot` 和 `parse_jm_home_snapshot` IPC handler，分别解析关键词搜索页（`/search/photos`）和首页（`/`）的 DOM 快照，复用现有 `_parse_search_results` / `_parse_home_sections`，不发起任何网络请求。
- Electron 新增 `validateJmSearchSnapshotUrl` / `validateJmHomeSnapshotUrl` 校验器，参数化 `captureJmChallengeSnapshot` 的 URL 校验，使搜索/首页 URL 的 DOM 可被捕获为快照。
- `recoverJmSearchChallenge` 增加与收藏夹对称的快照兜底：Python 重试仍被挑战时，用验证窗口已捕获的快照调 `parse_jm_search_snapshot` / `parse_jm_home_snapshot` 解析；并支持静默快照恢复（首次请求前预检）。

## 功能 (Capabilities)

### 新增功能

无。搜索快照兜底是对现有 `jm-interactive-challenge-recovery` 能力的行为补全，不引入新能力。

### 修改功能

- `jm-interactive-challenge-recovery`: 搜索挑战恢复在 Python 重试仍被挑战时必须走 DOM 快照兜底，分别覆盖关键词搜索（`/search/photos`）和首页空搜索（`/`），与收藏夹快照兜底对称。
- `login-window`: 挑战窗口的 DOM 快照捕获必须按 URL 用途区分校验规则——收藏夹快照仅接受收藏夹路径（现有），搜索快照接受 `/search/photos`（新增），首页快照接受根路径 `/`（新增）。
- `jm-source`: JM 解析器新增 `parse_search_snapshot` 和 `parse_home_snapshot` 方法，复用现有解析逻辑处理 Electron 捕获的可信 DOM，不发起网络请求。

## 影响

- **Python**：`sources/jm/constants.py`（指纹 + headers 版本号）、`sources/jm/parser.py`（新增 snapshot 方法 + 验证器）、`sources/__init__.py`（新增委托）、`python/ipc/search_mixin.py`（新增 handler + 验证器）、`python/ipc_server.py`（handler 注册）、`python/ipc/cover_mixin.py` 和 `sources/jm/title_resolver.py`（消除硬编码指纹）
- **Electron**：`electron/login-window.ts`（快照校验器 + 参数化捕获 + 隐藏快照窗口）、`electron/jm-challenge-recovery.ts`（搜索快照兜底编排 + 静默恢复状态）、`electron/main.ts`（搜索 handler 静默快照预检）
- **测试**：`tests/test_jm_parser.py`、`tests/test_search_mixin.py`、`tests/test_multi_source_parser.py`、`tests/test_ipc_contract.py`、`tests/unit/main/login-window.test.ts`、`tests/unit/main/jm-challenge-recovery.test.ts`，新增 `tests/test_jm_fingerprint_sync.py`
- **OpenSpec**：对 `jm-interactive-challenge-recovery`、`login-window`、`jm-source` 三项既有能力提供增量规范
- 无新依赖、无 IPC 参数破坏性变更、无持久化迁移
