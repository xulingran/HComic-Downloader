# 单元测试设计方案

## 概述

为 hcomic_downloader 项目补全核心模块的单元测试，聚焦纯逻辑模块，确保代码质量和可维护性。

## 技术选型

- **测试框架**: pytest + pytest-mock
- **覆盖率工具**: pytest-cov
- **测试数据**: 独立的 `tests/fixtures/` 目录
- **覆盖率目标**: parser.py 和 auth_parser.py 100%，其他模块 80%+

## 目录结构

```
hcomic_downloader/
├── tests/
│   ├── __init__.py
│   ├── conftest.py          # 共享 fixtures
│   ├── fixtures/            # 测试数据
│   │   ├── html/            # HTML 响应样本
│   │   │   ├── search_page.html
│   │   │   ├── favourites_page.html
│   │   │   └── detail_page.html
│   │   └── images/          # 测试图片样本
│   │       └── test_cover.jpg
│   ├── test_auth_parser.py  # curl 解析测试
│   ├── test_utils.py        # 工具函数测试
│   ├── test_models.py       # 数据模型测试
│   ├── test_config.py       # 配置管理测试
│   ├── test_parser.py       # 页面解析测试
│   └── test_cbz_builder.py  # CBZ 打包测试
├── pyproject.toml           # pytest 配置
└── requirements-dev.txt     # 开发依赖
```

## 依赖配置

### requirements-dev.txt

```
pytest>=8.0.0
pytest-mock>=3.12.0
pytest-cov>=4.1.0
```

### pyproject.toml

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
python_classes = ["Test*"]
python_functions = ["test_*"]

[tool.coverage.run]
source = ["."]
omit = ["tests/*", "venv/*", "*/site-packages/*"]

[tool.coverage.report]
precision = 2
show_missing = true
skip_covered = false
```

## 模块测试优先级

| 模块 | 优先级 | 覆盖率目标 | 测试重点 |
|------|--------|-----------|---------|
| `auth_parser.py` | 最高 | 100% | 各种 curl 命令格式的解析 |
| `parser.py` | 最高 | 100% | HTML/JS 对象解析，边界情况 |
| `utils.py` | 高 | 90%+ | 文件名清理、代理检测 |
| `models.py` | 中 | 80%+ | 属性方法、哈希/相等比较 |
| `config.py` | 中 | 80%+ | 加载/保存、默认值 |
| `cbz_builder.py` | 中 | 80%+ | CBZ 结构、ComicInfo.xml 格式 |

## 核心测试用例设计

### test_auth_parser.py

使用参数化测试覆盖各种 curl 格式：

```python
@pytest.mark.parametrize("curl_text,expected_cookie,expected_ua", [
    ('curl -H "Cookie: session=abc" -H "User-Agent: Mozilla"', 'session=abc', 'Mozilla'),
    ('curl -b "session=xyz" -A "Chrome"', 'session=xyz', 'Chrome'),
    ('curl --cookie "id=123" --user-agent "Firefox"', 'id=123', 'Firefox'),
    ('curl -H "Cookie: a=b" \\\n     -H "User-Agent: T"', 'a=b', 'T'),
])
def test_extract_auth_from_curl(curl_text, expected_cookie, expected_ua):
    cookie, ua = extract_auth_from_curl(curl_text)
    assert cookie == expected_cookie
    assert ua == expected_ua
```

异常测试：空文本、缺少 Cookie、缺少 UA、无效语法。

### test_utils.py

```python
@pytest.mark.parametrize("input_name,expected", [
    ("正常文件名", "正常文件名"),
    ("file<>name", "file__name"),
    ("file:name", "file_name"),
    ("file\\name", "file_name"),
    ("file|name?*name", "file_name__name"),
    ("  .file.  ", "file"),
    ("a" * 250, "a" * 200),
    ("", "unknown"),
])
def test_sanitize_filename(input_name, expected):
    assert sanitize_filename(input_name) == expected
```

### test_models.py

```python
def test_comic_info_hashable():
    comic1 = ComicInfo(id="1", comic_source="MMCG_SHORT")
    comic2 = ComicInfo(id="1", comic_source="MMCG_SHORT")
    comic3 = ComicInfo(id="2", comic_source="MMCG_SHORT")

    assert comic1 == comic2
    assert hash(comic1) == hash(comic2)
    assert len({comic1, comic2, comic3}) == 2

def test_get_image_url():
    comic = ComicInfo(id="12345", media_id="abcde", comic_source="MMCG_SHORT")
    assert comic.get_image_url(1) == "https://h-comic.link/api/mms/abcde/pages/1"
```

### test_parser.py

测试 HTML/JS 对象解析的核心逻辑：

```python
def test_extract_payload_data_success(parser):
    html = 'data: [null, {"data": {"comics": []}}], form:'
    result = parser._extract_payload_data(html)
    assert result == {"comics": []}

@pytest.mark.parametrize("invalid_html,error_msg", [
    ("无 payload 数据", "h-comic payload not found"),
    ("data: [null, invalid]", "h-comic payload root is not an object"),
    ("data: [null, {}]", "h-comic payload missing `data` object"),
])
def test_extract_payload_data_errors(parser, invalid_html, error_msg):
    with pytest.raises(ValueError, match=error_msg):
        parser._extract_payload_data(invalid_html)
```

使用 fixtures 目录的 HTML 样本：

```python
# conftest.py
@pytest.fixture
def html_sample():
    def _load(name: str) -> str:
        path = Path(__file__).parent / "fixtures" / "html" / name
        return path.read_text(encoding="utf-8")
    return _load

# test_parser.py
def test_parse_search_page(parser, html_sample):
    html = html_sample("search_page.html")
    comics, pagination = parser.parse_search_page(html, requested_page=1)
    assert len(comics) > 0
```

### test_cbz_builder.py

```python
def test_build_cbz_creates_valid_zip(sample_comic, sample_images, tmp_path):
    builder = CBZBuilder()
    output_path = tmp_path / "output.cbz"

    result = builder.build_cbz(sample_images, sample_comic, str(output_path))

    assert Path(result).exists()
    with zipfile.ZipFile(result, 'r') as zf:
        assert 'ComicInfo.xml' in zf.namelist()
        assert len([n for n in zf.namelist() if n.endswith('.jpg')]) == 3

def test_comic_info_xml_content(sample_comic, sample_images, tmp_path):
    """验证 ComicInfo.xml 格式正确"""
    builder = CBZBuilder()
    output_path = tmp_path / "output.cbz"

    builder.build_cbz(sample_images, sample_comic, str(output_path))

    with zipfile.ZipFile(output_path, 'r') as zf:
        xml_content = zf.read('ComicInfo.xml').decode('utf-8')

    assert '<Title>测试漫画</Title>' in xml_content
    assert '<Writer>测试作者</Writer>' in xml_content
```

### test_config.py

```python
def test_default_values():
    config = Config()
    assert config.concurrent_downloads == 4
    assert config.timeout == 30
    assert config.font_name == ""

def test_save_and_load(tmp_path):
    config_path = tmp_path / "config.json"

    original = Config(download_dir="/test/path", concurrent_downloads=8)
    original.save(str(config_path))

    loaded = Config.load(str(config_path))
    assert loaded.download_dir == "/test/path"
    assert loaded.concurrent_downloads == 8
```

## Mock 策略

| 场景 | 方法 |
|------|------|
| 网络请求 | `mocker.patch('requests.Session')` |
| 文件操作 | pytest 内置 `tmp_path` fixture |
| 环境变量 | `mocker.patch.dict(os.environ, {...})` |

## 运行命令

```bash
# 运行所有测试
pytest

# 详细输出
pytest -v

# 覆盖率报告
pytest --cov=. --cov-report=term-missing

# HTML 覆盖率报告
pytest --cov=. --cov-report=html

# 关键模块 100% 覆盖验证
pytest --cov=parser --cov=auth_parser --cov-fail-under=100
```

## 后续步骤

1. 创建 `tests/` 目录和 `conftest.py`
2. 添加 `requirements-dev.txt` 和 `pyproject.toml`
3. 收集 HTML 样本到 `fixtures/html/`
4. 按优先级编写各模块测试
5. 验证覆盖率目标
