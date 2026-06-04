## 1. Phase 1 — 地基（零依赖，可独立提交）

- [x] 1.1 常量集中管理：在 `download_manager.py` 定义 `_MAX_AUTO_RETRY_ATTEMPTS = 5`，在 `downloader.py` 定义 `DEFAULT_IMAGE_EXT = ".jpg"` 和 `PAGE_FILENAME_WIDTH = 3`，在 `sources/jmcomic/parser.py` 定义 `_CHALLENGE_MIN_LENGTH = 500` 和 `_CHALLENGE_KEYWORDS`，在 `image_downloader.py` 引用 `DEFAULT_IMAGE_EXT`
- [x] 1.2 提取 `_now()` → `python/ipc/image_utils.py`（或 `utils.py`），`cover_cache.py` 和 `preview_cache.py` 改为导入引用
- [x] 1.3 提取 `_fix_encoding(resp)` 静态方法到 `sources/jmcomic/parser.py`，替换 `verify_login_status`、`_ensure_username`、`favourites`、`_request_text` 共 4 处重复
- [x] 1.4 提取 `_resolve_source(source)` 到 `MultiSourceParser`，替换 `search`/`random`/`favourites`/`add_to_favourites`/`check_favourite`/`remove_from_favourites`/`get_comic_detail`/`verify_login_status` 共 8 处 `src = source or self.current_source`
- [x] 1.5 创建 `ParserContextMixin` 类（`close()`/`__enter__`/`__exit__`），4 个 parser（HComicParser、MoeImgParser、JmParser、BikaParser）继承它，删除各自重复的 3 个方法
- [x] 1.6 提取 `_safe_cleanup_temp_dir(temp_dir)` 到 `ComicDownloadManager`（或 `OutputStagingManager`），替换 5 处 `if temp_dir and os.path.exists(temp_dir): self.downloader.cleanup_temp_dir(temp_dir)` 模式
- [x] 1.7 运行 `pytest`、`ruff check . --fix`、`black --check .` 确认 Phase 1 无回归

## 2. Phase 2 — downloader.py 参数对象化

- [x] 2.1 在 `downloader.py` 顶部创建 `DownloadOptions` dataclass（7 字段：`progress_callback`, `delay_after`, `comic_info`, `completed_pages`, `failed_pages`, `cancel_event`, `pause_event`）
- [x] 2.2 在 `_DownloadRun` 上添加 `try_report_progress()` 方法，消除原 `_try_report_progress` 的 6 参数，将 `last_progress_ts` 从参数改为 `_DownloadRun` 的字段
- [x] 2.3 重构 `_submit_download_batch`：将 `pages, image_urls, temp_dir, download_referer, cancel_event` 合并为 `pages, run: _DownloadRun`，URL 构造复用常量化后的 `DEFAULT_IMAGE_EXT` 和 `PAGE_FILENAME_WIDTH`
- [x] 2.4 重构 `_apply_delay_after` 静态方法：将 `progress_callback` + `comic_info` 合并为 `options: DownloadOptions`，参数从 6 降为 4
- [x] 2.5 重构 `download_comic_resume` 签名：`comic, output_dir, options: DownloadOptions | None = None`，内部展开 `options` 为局部变量
- [x] 2.6 更新 `download_manager.py:_execute_download`（唯一调用方）：构造 `DownloadOptions` 对象传入
- [x] 2.7 运行 `pytest`（重点关注 `test_download_manager.py`、`test_downloader_source.py`）、`ruff check . --fix`、`black --check .`

## 3. Phase 3 — download_manager.py 竞态 + 重复 + 错误路由

- [x] 3.1 提取 `_modify_task_locked(task_id, *, guard, apply, post_notify=True, post_queue_notify=True, post_start=False)` 方法
- [x] 3.2 用 `_modify_task_locked` 重写 `pause_task`（`guard`: status in (DOWNLOAING, QUEUED)；`apply`: request_pause + 设置 PAUSING/PAUSED）
- [x] 3.3 用 `_modify_task_locked` 重写 `resume_task`（`guard`: status in (PAUSED, PAUSING)；`apply`: clear_pause + 设置 QUEUED；`post_start=True`）
- [x] 3.4 用 `_modify_task_locked` 重写 `cancel_task`（`guard`: status not terminal；`apply`: request_cancel + 设置 CANCELLED + queue.remove）
- [x] 3.5 用 `_modify_task_locked` 重写 `retry_task`（`guard`: status == FAILED；`apply`: 设置 QUEUED + retry_count++ + 清 error；`post_start=True`）
- [x] 3.6 修复竞态 TOCTOU：`_process_queue` drain 退出循环后，在调用 `_on_queue_complete` 前重新获取锁确认队列仍为空
- [x] 3.7 修复竞态 `started_at`：将 `task.started_at = time.time()` 移入 `_process_task` 的 `with self._lock` 块内
- [x] 3.8 修复竞态 `retry_count`：在 `_attempt_auto_retry` 读取 `task.retry_count` 时持有 `self._lock`
- [x] 3.9 修复错误路由：`_handle_download_success` 中打包失败抛 `RuntimeError("packaging failed")`（而非让 `Exception` 被上层当做下载失败触发重试）；在 `_handle_post_download` 中单独 catch 并标记 FAILED
- [x] 3.10 删除 `_execute_download` 中 `except (ValueError, IndexError)` 的 `IndexError`（`os.path.splitext` 永不抛此异常）
- [x] 3.11 基类 `DownloadManager._process_task` 添加 `try/except Exception` 保护，异常时调用 `_handle_download_exception`
- [x] 3.12 运行 `pytest`（重点关注 `test_download_manager.py`）、`ruff check . --fix`、`black --check .`

## 4. Phase 4 — jmcomic parser 巨型函数拆分 + 重复消除

- [x] 4.1 在 `sources/jmcomic/parser.py` 创建 `_DetailMetadata` dataclass（`author`, `tags`, `category`, `pages`, `publish_date`）
- [x] 4.2 提取 `_extract_title_from_doc(doc) → str`（5 策略回退），`_parse_detail_title` 和 `_fetch_title` 都调用它
- [x] 4.3 提取 `_locate_info_block(doc) → lxml.Element | None`
- [x] 4.4 提取 `_extract_scramble_id(html) → str`
- [x] 4.5 提取 `_parse_detail_chapters(doc) → list[ChapterInfo]`
- [x] 4.6 提取 `_parse_detail_images(doc, domain) → list[str]`
- [x] 4.7 提取 `_parse_detail_metadata(scope, html, domain) → _DetailMetadata`
- [x] 4.8 提取 `_expand_image_urls(image_urls, total, comic_id) → list[str]`
- [x] 4.9 提取 `_extract_cover_url(doc, domain) → str`
- [x] 4.10 重写 `_parse_detail` 为编排器：依次调用 7 个子方法 + 1 个共享方法，组装 `ComicInfo`
- [x] 4.11 提取 `_is_challenge_page(html) → bool`，替换 `verify_login_status`、`_ensure_username`、`favourites` 共 3 处 Cloudflare 检测
- [x] 4.12 降低 `_fetch_title` 嵌套深度（6→3）：提取 JSON-LD 解析为 `_extract_title_from_jsonld(script)` 辅助；添加 guard clause 提前返回
- [x] 4.13 运行 `pytest`（重点关注 `test_jmcomic_parser.py`、`test_jmcomic_favourites.py`）、`ruff check . --fix`、`black --check .`

## 5. Phase 5 — IPC 层参数爆炸 + 裸 except 收紧

- [x] 5.1 在 `python/ipc/history_mixin.py` 创建 `ReadingHistoryEntry` dataclass（11 字段），重构 `ReadingHistoryDB.upsert(entry: ReadingHistoryEntry)` 为 2 参数
- [x] 5.2 重构 `handle_add_history`：从 RPC params 解包构造 `ReadingHistoryEntry`，传给 `upsert()`，IPC 协议保持不变
- [x] 5.3 在 `python/ipc/search_mixin.py` 提取 `_VALID_SOURCES = ("hcomic", "jmcomic", "moeimg", "bika")` 模块级常量，替换 5 处重复
- [x] 5.4 在 `python/ipc/search_mixin.py` 提取 `_DEFAULT_SOURCE = "hcomic"` 常量，统一 `effective_source` 计算逻辑
- [x] 5.5 收紧 `cover_mixin.py` 中 3 处裸 `except Exception`：header 复制 → `except (AttributeError, TypeError): pass`；cookie 复制 → `except (AttributeError, KeyError): pass`
- [x] 5.6 收紧 `preview_mixin.py` 中 3 处裸 `except Exception`：缓存读取 → `except (OSError, sqlite3.Error): logger.debug(...)`；descramble → `except (ValueError, OSError): logger.warning(...)`；缓存写入 → `except (OSError, sqlite3.Error): logger.debug(...)`
- [x] 5.7 收紧 `search_mixin.py` 中 2 处裸 `except Exception`：cover_url 提取 → `except (KeyError, TypeError): cover_url = ""`；章节预览 → `except (requests.RequestException, ParserResponseError): logger.warning(...)`
- [x] 5.8 修复 `history_mixin.py` 中 f-string SQL 注入风险：`ADD COLUMN` 改为参数化或白名单检查后插值
- [x] 5.9 收紧 `favourite_tags_mixin.py` 中 `handle_sync_favourite_tags` 的错误处理：单页失败不中断整体同步，记录失败页码并继续
- [x] 5.10 运行 `pytest`（重点关注 `test_reading_history.py`、`test_ipc_preview.py`、`test_favourite_tags.py`）、`ruff check . --fix`、`black --check .`

## 6. Phase 6 — 其他散布项

- [x] 6.1 `image_downloader.py`：提取 `_write_chunks(response, fd, tmp_path, max_size)` 辅助方法，将 `download()` 嵌套从 7 级降为 3 级
- [x] 6.2 `cbz_builder.py`：提取 `_build_archive_internal(image_dir, comic, output_path, download_dir, overwrite, include_xml)`，`build_cbz` 和 `build_zip` 委托给它
- [x] 6.3 `sources/jmcomic/descrambler.py`：`src_img = Image.open(...)` 改为 `with Image.open(...) as src_img:`，修复异常路径未关闭资源
- [x] 6.4 `sources/moeimg/parser.py`：降低 `_lookup_entity_id_from_search` 嵌套深度（5→3）：提取 `_match_entity_item(item, keyword)` 辅助方法；添加 guard clause
- [x] 6.5 `sources/bika/parser.py`：提取 `_build_file_url(file_server, path) → str`，替换 `get_chapter_images` 和 `_parse_comic_item` 中相同的 8 行 URL 组装代码
- [x] 6.6 `python/ipc/migration_mixin.py`：`target_dir = os.path.normpath(target_dir)` 改为 `os.path.realpath`
- [x] 6.7 `python/ipc/auth_mixin.py`：移除 `handle_apply_auth` 中 cookie/bearer_token 长度的日志输出（信息安全泄漏）
- [x] 6.8 `config.py`：将 `set_source_auth(source, cookie, user_agent, bearer_token, username, password)` 的 6 参数封装为 `AuthSourceData` dataclass 或拆为独立方法
- [x] 6.9 `sources/__init__.py`：提取 `_VALID_SOURCES` 常量，修复 `source_supports_favourites` 和其他方法中硬编码四元组校验
- [x] 6.10 运行 `pytest`（全量）、`ruff check . --fix`、`black --check .`，确认全部 6 项检查通过
