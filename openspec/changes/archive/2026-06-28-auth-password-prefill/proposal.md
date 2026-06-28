## 为什么

对于支持账号密码登录的来源（hcomic、moeimg、bika），后端已在 `credential-persistence` 变更中保证登录失败时仍会持久化用户输入的账号密码。但前端设置页的账号/密码输入框仅在组件挂载时初始化一次，而配置是异步加载的，导致保存的凭据无法回填到表单中。用户在网络异常或密码错误导致登录失败后，再次打开设置页时看到的是空白表单，必须重新手动输入，违背了“凭据已保存”的预期。

## 变更内容

- **修复 username 回填失效**：`AuthSettings` 组件在挂载后异步拿到 `savedUsername` 时，通过 `useEffect` 将本地编辑 state 与 prop 同步，使已保存的用户名正确显示。
- **新增 password 回填**：后端 `get_config` 返回 hcomic/moeimg/bika 的已保存密码；前端 `AuthSettings` 用与 username 相同的机制回填密码输入框。
- **保持现有安全等级**：密码仍以明文形式存储和显示（与现有 `credential-persistence` 行为一致），输入框默认隐藏字符，用户可通过眼睛图标临时查看。
- **补充测试覆盖**：新增 SettingsPage 单测，验证异步加载配置后 username/password 能正确回填到三个来源的输入框。

## 功能 (Capabilities)

### 新增功能

- `auth-password-prefill`: 定义支持账号密码登录的来源在设置页表单中回填已保存凭据的需求。

### 修改功能

（无。本变更仅调整前端回填逻辑与后端配置返回字段，不改变认证能力的规范级行为。）

## 影响

- **代码**：
  - `python/ipc/config_mixin.py`：`handle_get_config` 新增返回三个 password 字段。
  - `shared/types.ts`：`AppConfig` 接口新增 `hcomicPassword`、`moeimgPassword`、`bikaPassword`。
  - `src/pages/SettingsPage.tsx`：读取并传递三个 `savedPassword` prop。
  - `src/components/settings/AuthSettings.tsx`：修复 username state 同步，新增 password state 初始化与同步。
  - `tests/unit/pages/SettingsPage.test.tsx`：新增凭据回填测试用例。
- **行为语义**：用户在登录失败后重新进入设置页，账号密码输入框均显示上次提交的值，可直接点击登录重试。
- **安全**：密码明文落盘与明文在前端显示均为既有行为，本变更不改变安全等级。
