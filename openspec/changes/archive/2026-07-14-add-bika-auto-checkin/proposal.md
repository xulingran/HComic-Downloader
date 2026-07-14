## 为什么

Bika 用户目前需要在其他客户端手动完成每日签到，进入本项目的 Bika 搜索页不会自动领取签到奖励。参考 haka_comic 的已有行为，本项目应在认证有效时静默检查当天签到状态，并在需要时自动签到。

## 变更内容

- 新增 Bika 用户签到状态检查与 `users/punch-in` 调用，复用现有已注入系统代理和认证信息的 Bika Session。
- 新增贯穿 Python JSON-RPC、Electron IPC 与 preload 的 Bika 自动签到接口。
- 用户进入 Bika 搜索页且认证有效后自动触发签到；已签到时不重复提交。
- 签到成功时显示成功 Toast；已签到或签到失败不阻塞搜索页和分类入口的正常使用。
- 增加解析器、IPC 契约和搜索页触发行为的回归测试。

## 功能 (Capabilities)

### 新增功能
- `bika-auto-checkin`: 定义 Bika 搜索页自动检查并完成每日签到的行为及非阻塞反馈。

### 修改功能
- `electron-ipc-contract`: 增加受类型约束的 Bika 自动签到 IPC 调用契约。

## 影响

- Python：`sources/bika/parser.py`、IPC Mixin/路由及对应测试。
- Electron/共享契约：`shared/types.ts`、`electron/main.ts`、`electron/preload.ts`。
- React：`src/hooks/useIpc.ts`、`src/pages/SearchPage.tsx` 与页面/预加载测试。
- 不引入新依赖，不新增独立网络 Session，不改变现有登录与搜索失败语义。
