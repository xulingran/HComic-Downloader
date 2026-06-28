## 上下文

`credential-persistence` 变更已在后端保证：hcomic、moeimg、bika 三个支持账号密码登录的来源，即使用户因网络异常或密码错误登录失败，输入的 `username`/`password` 也会被持久化到 `config.source_auth`。

当前前端的问题在于 `AuthSettings` 组件使用 `useState(savedUsername || '')` 初始化本地编辑 state。由于 `SettingsPage` 中的配置是异步加载的，`AuthSettings` 首次挂载时 prop 为空字符串，state 被锁死为空；即使后续配置加载完成、prop 更新，state 也不会同步。这导致**连 username 都无法回填**，password 更不可能回填。

本设计要解决的就是这个 state 与异步 prop 的同步问题，并把 password 也纳入回填范围。

## 目标 / 非目标

**目标：**
- 修复 username 在配置异步加载后无法回填的问题。
- 新增 password 回填：后端返回、前端接收并显示在密码输入框中。
- 覆盖 hcomic、moeimg、bika 三个来源。
- 保持现有输入框交互（默认隐藏、眼睛图标临时显示）。
- 补充 SettingsPage 单测覆盖凭据回填。

**非目标：**
- 不改变密码存储形态（仍为明文落盘到 `config.json`）。
- 不引入加密、keychain 或独立凭据管理器。
- 不改变登录失败时持久化凭据的后端行为（已由 `credential-persistence` 覆盖）。
- 不调整 jm/copymanga 的认证路径（它们不走账号密码字段）。

## 决策

### 决策 1：用 `useEffect` 同步 prop 到本地 state

在 `AuthSettings` 中为每个 `savedUsername`/`savedPassword` prop 添加 `useEffect`，当 prop 从空变为非空时更新本地 state：

```tsx
useEffect(() => {
  setHcomicUsername(hcomicSavedUsername || '')
}, [hcomicSavedUsername])

useEffect(() => {
  setHcomicPassword(hcomicSavedPassword || '')
}, [hcomicSavedPassword])
```

moeimg、bika 同理。

**为什么**：这是最小侵入式修复，不需要重构组件结构。`SettingsPage` 中的配置只在挂载时加载一次，后续不会在用户编辑时刷新，因此覆盖用户输入的风险极低。

**替代方案**：用 `key` 强制 `AuthSettings` 在配置加载后重新挂载。被否决——会丢失用户可能正在输入的内容，且比 `useEffect` 更粗暴。

### 决策 2：后端 `get_config` 直接返回明文 password

在 `python/ipc/config_mixin.py` 的 `handle_get_config` 中，与 username 并列返回 password：

```python
config["hcomicPassword"] = hcomic_auth.get("password", "")
config["moeimgPassword"] = self.config.source_auth.get("moeimg", {}).get("password", "")
config["bikaPassword"] = bika_auth.get("password", "")
```

**为什么**：前端回填需要知道已保存的密码值。password 与 username 在 `config.json` 中已以相同安全等级明文存储，一并返回不会引入新的暴露面。

**替代方案**：新增独立 IPC 通道（如 `get_source_credentials`）专门获取密码。被否决——增加 API 表面和权限管理复杂度，而当前 `get_config` 已经返回 username，扩展为返回 password 是自然而然的。

### 决策 3：password 不走 `set_config` / `ConfigKey`

`AppConfig` 接口新增可选 password 字段，但 `ConfigKey` / `ConfigValueMap` 不加入这些字段。password 的写入继续由登录 handler（`handle_hcomic_login` 等）负责，不通过前端 `setConfig` 直接写。

**为什么**：避免把 password 当作普通配置项通过 `set_config` 修改，保持写入路径单一、可审计。前端只读不回写。

## 风险 / 权衡

- **用户在编辑时 config 刷新导致输入被覆盖**：`SettingsPage` 不会在编辑过程中主动刷新 `getConfig`，风险极低；即便发生，`useEffect` 也会用保存值覆盖用户草稿，这是可接受的设置页行为。
  → 缓解：保持现状，不引入复杂的“用户是否手动修改过”判断。

- **密码明文出现在前端内存**：password 通过 IPC 传到渲染进程并存在 React state 中。这与现有行为一致（cookie/bearer_token 也早已通过同样路径传输）。
  → 缓解：不打印、不序列号到日志，仅在受控输入框中使用。

- **共享设备上的屏幕暴露**：任何能打开设置页的人可点击眼睛图标查看明文密码。这是方案 A 主动接受的行为；若未来需要更高安全性，可再引入主密码或 keychain。
  → 缓解：当前变更不改变安全等级，仅如实呈现后端已保存的值。
