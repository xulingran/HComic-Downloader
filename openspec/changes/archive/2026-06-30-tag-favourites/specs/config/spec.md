## 新增需求

### 需求:配置键 `myTags` 支持分来源的推荐标签白名单

系统必须支持配置键 `myTags`（Python 侧 `my_tags`），用于存储用户主动收藏的「推荐标签」白名单，结构为 `dict[source] → list[str]`，对称现有 `tag_blacklist`。该字段必须纳入 IPC `get_config`/`set_config` 契约，遵循与 `tag_blacklist` 完全一致的持久化、来源键归一化与默认值补齐规则。

#### 场景:默认值与来源键补齐

- **当** `config.json` 不存在 `my_tags` 键（首次安装或旧版本升级）
- **那么** `Config.load()` 必须返回含全部 5 个来源键（`hcomic`/`moeimg`/`jm`/`bika`/`copymanga`）的 `dict`，每个来源值为空数组 `[]`
- **且** `Config.__post_init__` 必须通过 `_normalize_source_list_map` 补齐缺失的来源键，逻辑与 `tag_blacklist` 一致

#### 场景:持久化与读取使用一致键名

- **当** 系统通过 `Config.save()` 持久化配置到 JSON 文件
- **那么** 推荐标签必须以 snake_case 键 `my_tags` 写入文件
- **当** 前端通过 `python:get-config` 读取配置
- **那么** 返回结果必须包含 camelCase 键 `myTags`，由 `CONFIG_KEY_MAP` 完成转换
- **当** 前端通过 `python:set-config` 写入
- **那么** 请求键必须为 `myTags`，经 `CONFIG_KEY_MAP` 反向转换为 `my_tags` 后写入 dataclass

#### 场景:IPC 参数校验对称 tag_blacklist

- **当** 前端通过 `python:set-config` 发送 `myTags` 字段
- **那么** Electron 主进程的 IPC 参数校验必须使用与 `tagBlacklist()` 校验器对称的规则：必须是对象、必须含全部 5 个来源键、每个键的值为数组、每项为非空字符串、单标签 ≤64 字符、数组内去重、每来源 ≤500 项
- **且** 校验失败必须拒绝请求，禁止写入配置

#### 场景:非法来源键被拒绝

- **当** `set-config` 的 `myTags` 包含非白名单来源键（如 `"unknown"` 或 `"jmcomic"` 旧键）
- **那么** 校验必须拒绝
- **且** 禁止将非法键写入配置

#### 场景:与 tag_blacklist 独立存储

- **当** 用户设置或修改 `myTags`
- **那么** 系统必须不影响 `tag_blacklist` 的值，二者必须独立存储与读写
- **且** 二者可以在同一来源下共存（不同标签），但同一标签字符串禁止同时出现在两者中（由前端写入逻辑与 store action 强制互斥，见 tag-favourites 规范）

#### 场景:后端配置归一化与向后兼容

- **当** Python `Config` 反序列化时遇到 `my_tags`，且某来源键缺失或值为非数组（如旧文件损坏）
- **那么** 系统必须按 `_normalize_source_list_map` 规则归一化：补齐缺失键为空数组、将非数组值重置为空数组
- **且** `Config.load()` 的「只保留已知字段」逻辑必须保留 `my_tags`（作为已知字段），丢弃其他未知 key
