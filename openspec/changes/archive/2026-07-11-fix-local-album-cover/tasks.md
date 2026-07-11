## 1. 补齐合集封面回归测试

- [x] 1.1 在 `tests/test_library_cache.py` 增加多章节文件夹封面测试，使用真实索引和读取器验证自然顺序第一章第一页的内容哈希、媒体类型及数据库 `cover_key`
- [x] 1.2 增加首章不可读取时回退到下一章，以及所有章节均不可读取时不写入封面键的测试

## 2. 实现合集封面选择

- [x] 2.1 在 `LibraryPageReader` 中增加基于已索引章节顺序的合集封面读取逻辑，逐章选择第一张可读取图片并隔离单章失败
- [x] 2.2 将合集分支接入 `extract_cover()`，继续复用现有内容哈希、原子缓存、LRU 和 `cover_key` 持久化流程，并保持 CBZ、ZIP、单本文件夹行为不变

## 3. 验证与质量检查

- [x] 3.1 运行 `pytest -q tests/test_library_cache.py`，确认新增场景与现有封面、页面和章节读取回归全部通过
- [x] 3.2 运行完整提交前验证：`pytest`、`npx tsc --noEmit`、`npm test`、`npm run lint:py`、`npm run format:py`、`npm run lint`、`npm run lint:test-quality`
