## 1. 安全修复：裸 except 和输入保护

- [x] 1.1 gui_app.py:1897 — 将 `except:` 改为 `except (subprocess.CalledProcessError, FileNotFoundError, OSError):`
- [x] 1.2 gui_app.py:1901 — 将 `except:` 改为 `except (subprocess.CalledProcessError, FileNotFoundError, OSError):`
- [x] 1.3 gui_app.py:2041 — 将 `except:` 改为 `except (tk.TclError, AttributeError):`
- [x] 1.4 gui_app.py:2065 — 将 `except:` 改为 `except (tk.TclError, AttributeError):`
- [x] 1.5 parser.py `_extract_payload_data` — 在方法开头添加 `len(resp_text) > 2_000_000` 长度检查，抛出 ValueError

## 2. 死代码清理

- [x] 2.1 panels/comic_card.py — 删除 `ComicCard` 类（第 317-381 行）
- [x] 2.2 panels/comic_card.py — 删除未使用的 `from concurrent.futures import ThreadPoolExecutor` import
- [x] 2.3 验证：运行 `grep -r "ComicCard" --include="*.py"` 确认无残留引用

## 3. 重复代码提取

- [x] 3.1 cbz_builder.py — 添加 `_get_download_dir(self, download_dir=None)` 私有方法
- [x] 3.2 cbz_builder.py `_generate_output_path` — 使用 `self._get_download_dir(download_dir)` 替换 fallback 逻辑
- [x] 3.3 cbz_builder.py `save_as_folder` — 使用 `self._get_download_dir(output_dir)` 替换 fallback 逻辑
- [x] 3.4 cbz_builder.py `_generate_output_path_for_format` — 使用 `self._get_download_dir(download_dir)` 替换 fallback 逻辑

## 4. 常量提取

- [x] 4.1 image_formats.py — 添加 `PAGE_FILENAME_FORMAT = "{page:03d}{ext}"` 常量
- [x] 4.2 downloader.py — 导入并使用 `PAGE_FILENAME_FORMAT` 替换 `f"{i+1:03d}.jpg"`
- [x] 4.3 cbz_builder.py — 导入并使用 `PAGE_FILENAME_FORMAT` 替换 2 处 `f"{i:03d}{ext}"` 模式

## 5. 代码组织修复

- [x] 5.1 models.py — 将第 114-115 行的 `from enum import Enum` 和 `import time` 移到文件顶部
- [x] 5.2 config.py `__post_init__` — 删除 `os.makedirs(self.download_dir, exist_ok=True)` 行
- [x] 5.3 gui_app.py `__init__` — 添加 `self._resize_after_id = None` 初始化
- [x] 5.4 gui_app.py `_on_window_resize` — 将 `hasattr(self, '_resize_after_id')` 改为 `self._resize_after_id`

## 6. 测试更新

- [x] 6.1 tests/test_config.py — 添加 `test_config_constructor_does_not_create_directory` 测试，验证 `Config()` 不再自动创建 download_dir
- [x] 6.2 运行全部测试 `python -m pytest tests/ -q`，确认 279+ 测试全部通过
