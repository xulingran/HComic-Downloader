# download-core-integrity 规范

## 目的

定义图片下载、格式识别、大小限制、代理注入、断点续传与并发会话管理的完整性测试要求，确保下载核心在异常和并发条件下仍保持文件与状态一致。
## 需求
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

#### 场景:JM 下载后反混淆产物必须可正确解码

- **当** 注入一段经 JM 混淆的图片字节，其 `image_url` 含 `/media/photos/421926/00001.webp`，下载完成后触发后处理
- **那么** 后处理产出的文件必须能被 PIL 正常解码，且其内容与用相同 URL 经预览路径反混淆的产出一致

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

### 需求:JM 下载反混淆参数必须从原始图片 URL 解析

JM 来源漫画下载完成后的图片后处理（反混淆）必须从每页的原始图片 URL 解析反混淆所需的 `eps_id` 与 `page_num`，与预览路径行为完全一致。`eps_id` 必须从 URL 路径 `/media/photos/{eps_id}/` 提取（URL 无法提取时回退到章节 id）；`page_num` 必须是 URL 末段的 5 位字符串（如 `"00001"`）。后处理禁止使用落盘文件名的 stem（3 位填充）或未经 URL 校验的章节 id 直接作为反混淆输入。

#### 场景:后处理从源 URL 提取 eps_id 与 5 位 page_num

- **当** 一个含 `scramble_id` 的 JM 章节（`comic.source_site == "jm"`）下载成功，其 `image_urls` 形如 `https://cdn.xxx/media/photos/421926/00001.webp`，落盘文件名为 `001.jpg`
- **那么** 后处理对该页调用 `descramble_image` 时，`eps_id` 必须为 `421926`（从 URL 提取），`page_num` 必须为 `"00001"`（descrambler 从 URL 提取），而非 `int(comic.id)` 或 `"001"`

#### 场景:后处理参数与预览路径一致

- **当** 同一 JM 章节的同一页图片分别经预览路径与下载后处理路径反混淆
- **那么** 两条路径传给 `descramble_image` 的 `eps_id` 与 `page_num` 必须完全相同，产出字节必须一致

#### 场景:image_urls 长度与文件数不匹配时跳过并告警

- **当** 某落盘文件的页号（`int(stem)`）超出 `comic.image_urls` 索引范围
- **那么** 后处理必须跳过该文件并记录告警，不得抛出异常中断其余文件的反混淆

#### 场景:非 JM 来源或无 scramble_id 不执行后处理

- **当** `comic.source_site != "jm"` 或 `comic.scramble_id` 为空
- **那么** 后处理必须立即返回，不对任何文件执行反混淆

