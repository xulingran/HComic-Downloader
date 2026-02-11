# HComic Downloader 设计文档

日期: 2026-02-10

---

## 1. 项目概述

HComic Downloader 是一个独立的漫画下载器，专门用于从 h-comic.com 网站下载漫画并保存为 CBZ 格式。

### 1.1 目标

- 提供简洁的 GUI 界面，支持搜索、预览和下载
- 下载漫画为 CBZ 格式，包含 ComicInfo.xml 元数据
- 轻量级设计，仅依赖 Python 标准库 + requests

### 1.2 功能特性

| 功能 | 描述 |
|------|------|
| 搜索 | 关键词搜索漫画 |
| 预览 | 显示封面、标题、作者、页数、分类、标签 |
| 下载 | 多线程下载，支持并发 |
| CBZ 打包 | 自动打包为 CBZ，嵌入 ComicInfo.xml |
| 元数据 | 保存标题、作者、分类、标签、页数、发布日期 |

---

## 2. 技术栈

- **Python**: 3.14+
- **GUI**: tkinter (Python 内置)
- **HTTP**: requests
- **图片处理**: Pillow (PIL)
- **并发**: threading (线程池)

---

## 3. 项目结构

```
hcomic_downloader/
├── main.py              # 程序入口
├── gui.py               # tkinter GUI 界面
├── downloader.py        # 下载逻辑
├── parser.py            # h-comic 页面解析
├── cbz_builder.py       # CBZ 打包 + ComicInfo.xml 生成
├── config.py            # 配置管理
├── utils.py             # 工具函数
├── requirements.txt     # 依赖列表
└── docs/
    └── plans/
        └── 2026-02-10-hcomic-downloader-design.md  # 本文件
```

---

## 4. 模块设计

### 4.1 main.py

程序入口，初始化 GUI。

```python
def main():
    app = HComicDownloaderGUI()
    app.mainloop()
```

### 4.2 gui.py

主 GUI 类，使用 tkinter 实现。

**类**: `HComicDownloaderGUI(tk.Tk)`

**方法**:
- `__init__()` - 初始化界面
- `create_widgets()` - 创建 UI 组件
- `search()` - 执行搜索
- `display_results()` - 显示搜索结果
- `download_selected()` - 下载选中的漫画
- `update_progress()` - 更新进度条

**界面布局**:
```
+------------------------------------------+
|  [搜索框: _________ ]        [搜索按钮]  |
+------------------------------------------+
|  搜索结果 (网格布局)                      |
|  +----------+  +----------+              |
|  | 封面图   |  | 封面图   |              |
|  |          |  |          |              |
|  +----------+  +----------+              |
|  漫画标题1     漫画标题2                 |
|  作者: XXX    作者: YYY                  |
|  24页         36页                       |
|  [下载按钮]   [下载按钮]                 |
+------------------------------------------+
|  进度: [========>    ] 60%  下载中...    |
+------------------------------------------+
```

### 4.3 parser.py

h-comic 页面解析模块。

**类**: `HComicParser`

**方法**:
- `search(keyword: str) -> List[ComicInfo]` - 搜索漫画
- `parse_search_page(html: str) -> List[ComicInfo]` - 解析搜索结果
- `parse_comic_detail(html: str) -> ComicInfo` - 解析漫画详情
- `extract_image_urls(comic: ComicInfo) -> List[str]` - 提取图片 URL

**数据来源**:
- 搜索页: `https://h-comic.com/?q={keyword}`
- 详情页: `https://h-comic.com/comics/{slug}?id={id}`
- 图片 API: `https://h-comic.link/api/{source}/{media_id}/pages/{page}`

### 4.4 downloader.py

下载模块，支持多线程下载。

**类**: `ComicDownloader`

**方法**:
- `download_comic(comic: ComicInfo, output_dir: str)` - 下载完整漫画
- `download_image(url: str, path: str)` - 下载单张图片
- `download_with_progress(urls: List[str], output_dir: str, progress_callback)` - 带进度回调的下载

**配置**:
- 并发数: 4 (可配置)
- 超时: 30 秒
- 重试: 3 次

### 4.5 cbz_builder.py

CBZ 打包和元数据生成模块。

**类**: `CBZBuilder`

**方法**:
- `build_cbz(image_dir: str, comic: ComicInfo, output_path: str)` - 创建 CBZ 文件
- `generate_comic_info_xml(comic: ComicInfo) -> str` - 生成 ComicInfo.xml
- `sanitize_filename(name: str) -> str` - 清理文件名

**ComicInfo.xml 字段映射**:

| h-comic 字段 | ComicInfo.xml 字段 |
|-------------|-------------------|
| title | Title, Series |
| artist | Writer |
| btype (分类) | Genre |
| tags | Tags |
| pages | PageCount |
| public_date | Year, Month, Day |
| preview_url | Web |

### 4.6 config.py

配置管理模块。

**类**: `Config`

**配置项**:
- `download_dir` - 下载目录 (默认: ~/Downloads/hcomic)
- `concurrent_downloads` - 并发数 (默认: 4)
- `timeout` - 超时秒数 (默认: 30)
- `retry_times` - 重试次数 (默认: 3)
- `cbz_filename_template` - CBZ 文件名模板 (默认: "{author}-{title}.cbz")

### 4.7 utils.py

工具函数。

**函数**:
- `sanitize_filename(name: str) -> str` - 清理文件名中的非法字符
- `ensure_dir(path: str)` - 确保目录存在
- `format_file_size(size: int) -> str` - 格式化文件大小

---

## 5. 数据模型

### 5.1 ComicInfo

```python
@dataclass
class ComicInfo:
    id: str                    # 漫画 ID
    title: str                 # 标题
    author: str                # 作者
    pages: int                 # 页数
    category: str              # 分类
    tags: List[str]            # 标签列表
    publish_date: str          # 发布日期 (YYYY-MM-DD)
    cover_url: str             # 封面图 URL
    preview_url: str           # 详情页 URL
    media_id: str              # 媒体 ID (用于图片 URL)
    comic_source: str          # 图源 (MMCG_SHORT, MMCG_LONG, NH)
```

---

## 6. 核心流程

### 6.1 搜索流程

```
用户输入关键词
    │
    ▼
GUI 调用 parser.search(keyword)
    │
    ▼
发送 GET 请求到 h-comic.com/?q={keyword}
    │
    ▼
解析返回的 HTML，提取 payload JSON
    │
    ▼
返回 List[ComicInfo]
    │
    ▼
GUI 显示搜索结果 (封面网格)
```

### 6.2 下载流程

```
用户点击下载按钮
    │
    ▼
GUI 调用 downloader.download_comic(comic, output_dir)
    │
    ▼
计算所有图片 URL
    │
    ▼
创建临时目录 temp/{comic.id}/
    │
    ▼
多线程下载图片到临时目录
    │
    ▼
所有图片下载完成?
    ├─ 是 ──> 调用 cbz_builder.build_cbz()
    │           │
    │           ▼
    │       生成 ComicInfo.xml
    │           │
    │           ▼
    │       打包为 CBZ
    │           │
    │           ▼
    │       移动到输出目录
    │           │
    │           ▼
    │       删除临时目录
    │           │
    │           ▼
    │       完成
    │
    └─ 否 ──> 显示错误，保留已下载图片
```

---

## 7. 错误处理

| 错误场景 | 处理策略 |
|---------|---------|
| 网络连接失败 | 提示检查网络，提供重试按钮 |
| 搜索无结果 | 显示"未找到相关漫画"提示 |
| 图片下载失败 | 重试 3 次，失败后跳过该图片，继续下载其他 |
| CBZ 创建失败 | 保留临时目录，提示手动打包 |
| 磁盘空间不足 | 检查可用空间，提前提示 |
| 文件已存在 | 提示覆盖或重命名 |

---

## 8. 界面原型

### 8.1 主窗口

```
┌─────────────────────────────────────────────────────────┐
│  HComic Downloader                              [_][X]  │
├─────────────────────────────────────────────────────────┤
│  搜索: [____________________] [搜索]                    │
├─────────────────────────────────────────────────────────┤
│  搜索结果:                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ [封面图] │  │ [封面图] │  │ [封面图] │              │
│  │          │  │          │  │          │              │
│  └──────────┘  └──────────┘  └──────────┘              │
│  漫画标题 1    漫画标题 2    漫画标题 3                 │
│  作者: AAA     作者: BBB     作者: CCC                  │
│  24页          36页          18页                       │
│  [下载]        [下载]        [下载]                     │
│                                                         │
│  ┌──────────┐  ┌──────────┐                            │
│  │ [封面图] │  │ [封面图] │                            │
│  │          │  │          │                            │
│  └──────────┘  └──────────┘                            │
│  漫画标题 4    漫画标题 5                               │
│  作者: DDD     作者: EEE                                │
│  42页          28页                                     │
│  [下载]        [下载]                                   │
├─────────────────────────────────────────────────────────┤
│  状态: 就绪                                             │
│  进度: [____________________] 0%                        │
└─────────────────────────────────────────────────────────┘
```

### 8.2 详情弹窗 (可选)

点击封面可以弹出详情窗口，显示：
- 大图封面
- 完整标题
- 作者
- 页数
- 分类
- 标签列表
- 发布日期
- [下载] 按钮

---

## 9. 依赖列表

```
# requirements.txt
requests>=2.28.0
Pillow>=9.0.0
```

---

## 10. 参考代码

本项目参考 ComicGUISpider 项目中的 h_comic 爬虫实现：
该项目绝对路径为：/Users/zhong/Program/ComicGUISpider

- 爬虫: `ComicSpider/spiders/h_comic.py`
- 解析器: `utils/website/ins.py` (HComicUtils)
- 数据模型: `utils/website/info.py` (HComicBookInfo)

---

## 11. 待办事项

- [ ] 实现 parser.py 解析模块
- [ ] 实现 downloader.py 下载模块
- [ ] 实现 cbz_builder.py 打包模块
- [ ] 实现 gui.py 界面
- [ ] 集成测试
- [ ] 打包为可执行文件 (可选)

---

## 12. 附录

### 12.1 h-comic API 说明

**搜索页数据格式**:

页面中包含 JavaScript 代码，其中 `data: [null, {...}]` 包含漫画数据。

```javascript
data: [null, {
    data: {
        comics: [
            {
                id: 12345,
                media_id: "67890",
                title: { display: "漫画标题", japanese: "...", english: "..." },
                num_pages: 24,
                upload_date: 1705276800,
                tags: [
                    { type: "artist", name: "作者名" },
                    { type: "category", name: "分类名", name_zh: "中文分类" },
                    { type: "tag", name: "标签名" }
                ],
                comic_source: "MMCG_SHORT"
            }
        ]
    }
}]
```

**图片 URL 格式**:

```
https://h-comic.link/api/{source}/{media_id}/pages/{page}

source 映射:
- MMCG_SHORT -> mms
- MMCG_LONG -> mml
- 其他 -> nh
```

### 12.2 ComicInfo.xml 完整示例

```xml
<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema"
           xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <Title>示例漫画标题</Title>
    <Series>示例漫画标题</Series>
    <Number>1</Number>
    <Writer>作者名</Writer>
    <Genre>同人誌</Genre>
    <Tags>标签1, 标签2, 标签3</Tags>
    <PageCount>24</PageCount>
    <Year>2024</Year>
    <Month>1</Month>
    <Day>15</Day>
    <Web>https://h-comic.com/comics/example?id=12345</Web>
</ComicInfo>
```
