## 新增需求

### 需求:运行时配置键白名单必须与公开配置契约一致

系统必须以共享的 `CONFIG_KEYS` 作为 renderer/preload 可持久化配置键的运行时白名单，并保证公开 `ConfigKey` 类型不包含任何未被 `CONFIG_KEYS` 接受的键。所有已声明为可持久化的配置键（包括 `myTags`）必须能够通过 preload 的 `setConfig` 校验并转发到主进程；未声明键必须继续被拒绝。

#### 场景:preload 接受并转发 myTags

- **当** renderer 调用 `window.hcomic.setConfig('myTags', value)`，且 `value` 是合法的分来源标签对象
- **那么** preload 必须接受 `myTags` 配置键
- **且** 必须通过 `python:set-config` 通道将原始键和值转发到 Electron 主进程

#### 场景:未知配置键仍被拒绝

- **当** renderer 调用 `window.hcomic.setConfig` 并传入未包含在 `CONFIG_KEYS` 中的键
- **那么** preload 必须在进入主进程 IPC 前抛出 `Invalid config key`
- **且** 禁止调用 `ipcRenderer.invoke`

#### 场景:配置键类型与运行时白名单防止漂移

- **当** 开发者新增或修改可持久化配置键
- **那么** `ConfigKey` 必须由 `CONFIG_KEYS` 推导或由等价的编译期/测试期守卫验证二者全集一致
- **且** 删除 `CONFIG_KEYS` 中的 `myTags` 时，preload 配置契约回归测试必须失败

## 修改需求

无。

## 移除需求

无。
