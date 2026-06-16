## 新增需求

### 需求:图片下载必须验证真实落盘与格式检测路径

系统必须提供集成测试，用注入的响应字节（而非真实 HTTP）验证 `ImageDownloader.download` 从 URL 校验到落盘的完整路径，确保文件正确写入且扩展名按内容正确识别。

#### 场景:正常下载落盘并按 Content-Type 命名扩展名

- **当** 注入一个返回合法 JPEG 字节且 `Content-Type: image/jpeg` 的响应，调用 `download`
- **那么** 目标路径必须生成文件，文件扩展名必须为 `.jpg`，文件内容必须与注入字节一致，临时文件必须被清理

#### 场景:Content-Type 缺失时按 PIL 检测格式

- **当** 注入一个返回合法 PNG 字节但无 `Content-Type` 的响应
- **那么** 落盘文件扩展名必须通过 PIL 检测确定为 `.png`

#### 场景:非图片字节回退默认扩展名

- **当** 注入一个返回非图片字节（如纯文本）的响应
- **那么** 下载不得失败崩溃，落盘文件必须使用默认扩展名（`.jpg`）

### 需求:图片下载必须验证大小上限防护

系统必须验证 `ImageDownloader` 对超过大小上限的响应正确拦截，防止内存或磁盘耗尽。

#### 场景:超过 100MB 上限的响应被拦截

- **当** 注入一个累计字节数超过 `MAX_IMAGE_SIZE`（100MB）的流式响应
- **那么** `download` 必须抛出 `DownloadError`，错误信息必须表明图片过大，临时文件必须被清理

### 需求:图片下载必须验证网络错误路径

系统必须验证 `ImageDownloader` 对各类网络错误的正确处理，确保错误以 `DownloadError` 形式向上传播且不泄漏 Session。

#### 场景:HTTP 错误状态码抛出

- **当** 注入一个返回 HTTP 404 或 500 的响应
- **那么** `download` 必须抛出 `DownloadError`

#### 场景:网络超时抛出

- **当** 注入一个触发 `requests.Timeout` 的响应
- **那么** `download` 必须捕获并抛出 `DownloadError`

#### 场景:下载失败后 Session 必须归还池

- **当** 一次下载因任何异常失败
- **那么** 借出的 Session 必须被归还到池中（或按过期策略关闭），不得泄漏

### 需求:代理注入契约必须被验证

系统必须验证 `ImageDownloader` 创建的 Session 符合 AGENTS.md 的硬约束——所有网络请求必须走系统代理，落实 `apply_system_proxy_to_session` 契约。

#### 场景:Session 创建后代理已注入

- **当** 实例化 `ImageDownloader` 并获取其池中的 Session
- **那么** 该 Session 必须已应用系统代理（`trust_env=True` 且代理配置已注入），符合 `apply_system_proxy_to_session` 契约

### 需求:断点续传必须验证中断恢复的数据完整性

系统必须验证下载中断后恢复不损坏已下载的数据，确保分片写入与最终拼装的完整性。

#### 场景:中断后重下生成完整文件

- **当** 一次下载在中途被中断（部分分片已写入），随后重新下载
- **那么** 最终文件必须完整且内容正确，已下载的分片不得损坏

### 需求:会话池必须在并发获取与认证更新下保持一致

系统必须验证 `ImageDownloader` 会话池在并发 checkout/release 与认证头动态更新下的正确性，确保无死锁、无 Session 泄漏。

#### 场景:并发获取与归还不丢失 Session

- **当** 多个线程并发从池中获取并归还 Session
- **那么** 池中 Session 总数必须守恒，无 Session 泄漏或重复借出

#### 场景:认证更新不阻塞正在使用的 Session

- **当** `configure_auth` 更新认证头时，有 Session 正被使用（checked-out）
- **那么** 更新不得阻塞或排空池，待归还的 Session 在下次获取时必须应用新认证头
