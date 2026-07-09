## 1. 下沉共享辅助函数

- [x] 1.1 将 `python/ipc/preview_mixin.py` 中的 `_resolve_eps_id` 移至 `sources/jm/descrambler.py`（与 `_extract_eps_id` 同模块），保持"优先从 URL 提取、回退 `comic_id`、再回退 0"的语义不变
- [x] 1.2 更新 `python/ipc/preview_mixin.py` 改为从 `sources.jm.descrambler` 导入 `_resolve_eps_id`，删除本地副本
- [x] 1.3 运行 `pytest tests/test_ipc_preview.py tests/test_jm_descrambler.py` 确认预览路径无回归

## 2. 修复下载后处理参数来源

- [x] 2.1 重构 `downloader.py` 的 `ComicDownloader._maybe_postprocess_images`：遍历 `temp_dir` 文件时，用 `int(img_file.stem) - 1` 索引 `comic.image_urls` 取得该页原始 URL；做边界校验，越界则告警跳过该文件
- [x] 2.2 用共享 `_resolve_eps_id(url, comic.id)` 解析 `eps_id`，并以 `descramble_image(original, eps_id, image_url=url)` 形式调用（让 descrambler 内部提取 5 位 `page_num`），删除原 `int(comic.id)` 与 `img_file.stem` 的传参
- [x] 2.3 保留 `source_site != "jm" or not scramble_id` 的早退守卫与逐文件 `try/except` 告警容错不变

## 3. 测试

- [x] 3.1 在 `tests/test_downloader.py`（或同类下载测试文件）新增用例：构造含 `scramble_id` 的 JM `ComicInfo`（`image_urls` 形如 `.../media/photos/421926/00001.webp`）与临时目录文件，断言后处理调用 `descramble_image` 时传入的 `eps_id == 421926` 且 `image_url` 为对应页 URL（而非 `comic.id` 或文件名 stem）
- [x] 3.2 新增"image_urls 长度与文件数不匹配时跳过并告警、不抛异常"的用例
- [x] 3.3 新增"非 JM 来源或无 scramble_id 不执行后处理"的用例
- [x] 3.4 新增等价性用例：同一页经下载后处理与预览路径 `_apply_descramble` 反混淆后产出字节一致

## 4. 验证

- [x] 4.1 `pytest`（全量，含新增用例）
- [x] 4.2 `npx tsc --noEmit`
- [x] 4.3 `npm run lint:py && npm run format:py`
- [x] 4.4 `npm run lint:test-quality`
- [x] 4.5 `openspec-cn validate fix-jm-download-descramble --strict`
