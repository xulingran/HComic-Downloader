## 为什么

jmcomic 用户在搜索框输入纯数字漫画 ID（如 `430371`）时，期望直接定位到对应漫画，而不是得到空结果。当前项目的 `JmParser.search()` 只解析搜索结果列表页，对详情页响应返回空列表。参考 ComicGUISpider 的实现，jmcomic 对纯数字搜索词会返回专辑详情页，因此需要在解析层支持这种 ID 直搜行为。

## 变更内容

- 在 `sources/jmcomic/parser.py` 的 `JmParser.search()` 中新增漫画 ID 识别逻辑：
  - 当 `keyword` 为纯数字时，优先请求 `/album/{id}` 并解析为单条结果。
  - 若详情页获取失败或 ID 不存在，优雅 fallback 到普通关键词搜索。
- 在搜索结果解析中保留详情页兜底识别：如果服务端对任意搜索词返回详情页（HTML 含 `album_photo_cover` 和 `var aid = ...`），也能正确解析为单条结果。
- 为 ID 搜索路径补充单元测试，覆盖成功命中、失败 fallback、详情页响应检测三种场景。

## 功能 (Capabilities)

### 新增功能
- `jmcomic-id-search`: jmcomic 来源在 keyword 模式下支持输入纯数字漫画 ID 直接定位专辑。

### 修改功能
- 无现有规范级行为变更。

## 影响

- 受影响文件：
  - `sources/jmcomic/parser.py`（核心解析逻辑）
  - `tests/test_jmcomic_parser.py`（新增回归测试）
- 不影响前端 UI、IPC 契约或搜索模式枚举；用户仍在 keyword 模式下输入 ID。
- 向后兼容：普通关键词搜索、排行榜搜索、随机漫画逻辑保持不变。
