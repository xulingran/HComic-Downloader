## 为什么

JM 首页空白搜索遇到 Cloudflare 后，Python 会正确返回根地址 `https://18comic.vip/` 作为挑战 URL，但 Electron 的挑战窗口校验器只接受收藏夹路径，导致恢复流程在开窗前失败并显示“人机验证地址无效”。同一校验缺口也会拒绝普通 JM 搜索的 `/search/photos` URL，使既有搜索挑战恢复规范实际上无法端到端工作。

## 变更内容

- 将 JM 挑战窗口的“可加载目标 URL”校验与“可捕获收藏夹快照 URL”校验拆分，避免用收藏夹专用规则限制搜索恢复。
- 交互挑战窗口在保持 HTTPS、可信域、无凭据、默认端口、无 fragment 等安全约束的前提下，允许 JM 首页根路径、普通搜索路径和既有收藏夹路径。
- 对首页和搜索 URL 分别实施严格查询参数白名单；拒绝任意路径、任意查询参数及跨域目标。
- 收藏夹 DOM 快照继续只接受 `/user/{name}/favorite/albums`，禁止因放宽开窗目标而扩大快照信任边界。
- 补充真实的跨模块测试，使搜索恢复经过 `recoverJmSearchChallenge → openJmChallengeWindow → resolveJmChallengeTarget`，避免 mock 掩盖校验器不兼容。
- 保持 Cookie 双域写入、`verify_auth=false` 时仍保存凭据、单飞窗口和一次性重试行为不变。

## 功能 (Capabilities)

### 新增功能

<!-- 无。 -->

### 修改功能

- `jm-challenge-recovery`: 搜索挑战恢复必须接受受信任的 JM 首页根 URL 与 `/search/photos` URL，并端到端打开实际受挑战地址。
- `login-window`: 挑战窗口的目标校验必须按用途区分通用交互导航与收藏夹快照捕获，维持最小权限边界。

## 影响

- Electron：`electron/login-window.ts` 的 JM URL 校验、挑战窗口打开与快照捕获边界；`electron/jm-challenge-recovery.ts` 的错误映射和调用契约。
- 测试：`tests/unit/main/login-window.test.ts`、`tests/unit/main/jm-challenge-recovery.test.ts`，以及必要的主进程 handler 行为测试。
- OpenSpec：对 `login-window` 与 `jm-challenge-recovery` 两项既有能力提供完整增量规范。
- 无新依赖、无 IPC 参数变化、无持久化迁移，不修改 Python Cookie/Session/系统代理实现。
