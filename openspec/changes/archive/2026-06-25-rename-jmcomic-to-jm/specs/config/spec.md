## 修改需求

### 需求:配置键 `jmDomain` 替代 `jmcomicDomain`
配置文件中与 JMComic 来源域名相关的配置键从 `jmcomicDomain` 变更为 `jmDomain`，同时必须向后兼容旧键。

#### 场景:写入配置时使用新键
- **当** 系统持久化配置到 JSON 文件时
- **那么** jm 域名配置必须写入键 `jmDomain`，而非 `jmcomicDomain`

#### 场景:读取配置时兼容旧键
- **当** 系统从 JSON 文件加载配置时
- **那么** 如果 `jmDomain` 不存在但 `jmcomicDomain` 存在，系统必须将 `jmcomicDomain` 的值复制到 `jmDomain`

#### 场景:IPC 配置界面读写使用新键
- **当** 前端发送 `python:get-config` 或 `python:set-config` IPC 请求时
- **那么** 请求中的配置键必须为 `jmDomain`，返回结果中也必须包含 `jmDomain`
