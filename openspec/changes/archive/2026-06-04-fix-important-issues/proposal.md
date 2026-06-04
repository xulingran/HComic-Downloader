## 为什么

经过 L3 (Team) 标准的全套代码审查，Python 后端暴露了 40+ 处"重要"级别问题：函数参数过多（最高 11 个）、单函数超 110 逻辑行、代码重复（识别到 10 种模式）、裸 `except Exception` 吞异常、深层嵌套（最高 7 级）、竞态条件、错误处理路径混乱。这些问题不阻碍功能，但会显著拖慢新人上手和回归排查的速度。应在下一个功能变更前清理完毕。

## 变更内容

1. **参数对象化** — 为 `download_comic_resume` (9 参数)、`ReadingHistoryDB.upsert` (11 参数)、`Config.set_source_auth` (6 参数) 等引入 dataclass/TypedDict
2. **巨型函数拆分** — `JmParser._parse_detail` (110+ 逻辑行) 拆为 7 个子方法；`image_downloader.download()` 降低嵌套深度
3. **消除重复** — 提取 `_resolve_source`、`_fix_encoding`、`_is_challenge_page`、`_modify_task_locked`、`BaseParser` mixin 等共享抽象
4. **修复竞态** — `download_manager.py` 中 `started_at` 锁外写入、`retry_count` 无锁读取、drained-callback TOCTOU
5. **收紧异常处理** — 裸 `except Exception` 替换为 `requests.RequestException` + `ParserResponseError`
6. **魔术数字常量化** — `MAX_AUTO_RETRY_CAP`、`DEFAULT_IMAGE_EXT`、`PAGE_FILENAME_WIDTH` 等
7. **错误路径修正** — 打包失败不再触发下载重试；f-string SQL 改为参数化；`normpath` → `realpath`

## 功能 (Capabilities)

### 新增功能

无。此为纯代码质量重构，不引入面向用户的新功能。

### 修改功能

无。不涉及规范层面的行为变更。所有对外接口（IPC 协议、API 签名）保持向后兼容。

## 影响

- **受影响文件**: ~20 个 Python 文件（downloader.py, download_manager.py, sources/jmcomic/parser.py, sources/__init__.py, python/ipc/*.py 等）
- **测试**: 现有 371 个 pytest 用例应全部保持通过；需更新因签名变更导致的 mock 调用
- **对外接口**: 无破坏性变更。`download_comic_resume` 新增 `options` 关键字参数，旧式 keyword 参数可并存过渡
- **性能**: 无影响。提取的辅助函数/方法在热点路径上引入最多 1 层函数调用开销
