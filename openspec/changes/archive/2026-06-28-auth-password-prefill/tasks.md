## 1. 后端：在 get_config 中返回已保存密码

- [x] 1.1 在 `python/ipc/config_mixin.py` 的 `handle_get_config` 中，与 username 并列新增返回：
  - `config["hcomicPassword"] = hcomic_auth.get("password", "")`
  - `config["moeimgPassword"] = self.config.source_auth.get("moeimg", {}).get("password", "")`
  - `config["bikaPassword"] = bika_auth.get("password", "")`
- [x] 1.2 运行 Python 测试，确认 `get_config` 相关测试通过。

## 2. 共享类型：扩展 AppConfig 接口

- [x] 2.1 在 `shared/types.ts` 的 `AppConfig` 接口中新增可选字段：
  - `hcomicPassword?: string`
  - `moeimgPassword?: string`
  - `bikaPassword?: string`
- [x] 2.2 运行 `npx tsc --noEmit` 确认类型无冲突。

## 3. 前端 SettingsPage：读取并传递已保存密码

- [x] 3.1 在 `src/pages/SettingsPage.tsx` 的 `ConfigState` 接口中新增：
  - `hcomicPassword: string`
  - `moeimgPassword: string`
  - `bikaPassword: string`
- [x] 3.2 在初始 `config` state 中将三个 password 字段默认设为空字符串。
- [x] 3.3 在 `loadConfig()` 中从 `result.config` 读取三个 password 字段并写入 state。
- [x] 3.4 向 `AuthSettings` 传递三个新 prop：
  - `hcomicSavedPassword={config.hcomicPassword || ''}`
  - `moeimgSavedPassword={config.moeimgPassword || ''}`
  - `bikaSavedPassword={config.bikaPassword || ''}`

## 4. 前端 AuthSettings：修复 username 回填并新增 password 回填

- [x] 4.1 在 `AuthSettingsProps` 中新增：
  - `hcomicSavedPassword: string`
  - `moeimgSavedPassword: string`
  - `bikaSavedPassword: string`
- [x] 4.2 将三个 password 的 `useState('')` 初始值改为对应 `savedPassword || ''`。
- [x] 4.3 为三个 username 添加 `useEffect`，在 `savedUsername` 变化时同步到本地 state，修复异步加载后不回填的问题。
- [x] 4.4 为三个 password 添加 `useEffect`，在 `savedPassword` 变化时同步到本地 state。
- [x] 4.5 确保密码输入框仍默认 `type="password"`，眼睛图标交互保持不变。

## 5. 测试

- [x] 5.1 在 `tests/unit/pages/SettingsPage.test.tsx` 中新增测试：
  - 模拟 `getConfig` 返回 hcomic/moeimg/bika 的 username 和 password
  - 展开各来源认证卡片
  - 断言对应输入框的值与配置一致
- [x] 5.2 运行 `npm test` 确认前端测试通过。
- [x] 5.3 运行完整验证流程：pytest、`npx tsc --noEmit`、npm test、lint。
