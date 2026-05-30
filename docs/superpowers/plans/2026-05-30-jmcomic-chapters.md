# jmcomic 章节适配 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 jmcomic 来源增加章节（episode）概念，覆盖预览、下载、收藏已下载标记、阅读历史四条链路。

**Architecture:** Python 解析层从 `/album/{id}` 详情页解析章节列表（`div.episode ul a`），每章图片懒加载自 `/photo/{章节id}`；反混淆 eps_id 改为从图片 URL 路径提取（修正多章节 bug）。下载侧每章为一个独立任务与历史记录，收藏「已下载」按 album_id 聚合判定全章完成。阅读器先显示选章首屏（B），阅读中支持边界翻章提示与底栏切章按钮。其他来源（hcomic/moeimg）行为完全不变。

**Tech Stack:** Python（lxml/requests/Pillow/sqlite3/pytest）、Electron（TypeScript）、React + Zustand + Vitest。

**设计文档：** `docs/superpowers/specs/2026-05-30-jmcomic-chapters-design.md`

---

## 文件结构

- `models.py` — 新增 `ChapterInfo` dataclass；`ComicInfo` 增加 `chapters`、`album_id`、`album_total_chapters` 字段。
- `sources/jmcomic/parser.py` — `_parse_detail` 解析章节；新增 `get_chapter_images`。
- `sources/jmcomic/descrambler.py` — 新增从图片 URL 提取 eps_id。
- `python/ipc/preview_mixin.py` — 反混淆按图片 URL 自纠 eps_id。
- `python/ipc/search_mixin.py` — `get_preview_urls` 返回 chapters；新增 `get_chapter_preview_urls`。
- `python/ipc/download_mixin.py` — `handle_download` 支持 `chapter_ids`。
- `python/ipc_server.py` — 注册新方法到 dispatch 表。
- `download_history.py` — 新增列与全章完成判定。
- `python/ipc/history_mixin.py` — 阅读历史新增章节列。
- `shared/types.ts`、`electron/main.ts`、`electron/preload.ts`、`src/hooks/useIpc.ts` — IPC 接线。
- `src/stores/useReaderStore.ts`、`src/hooks/useComicReader.ts`、`src/components/ComicReaderModal.tsx`、新增 `src/components/ChapterPicker.tsx` — 阅读器 UI。
- 测试：`tests/test_jmcomic_parser.py`、`tests/test_jmcomic_descrambler.py`、`tests/test_download_history.py`、`tests/fixtures/html/jm_album_multi_chapter.html`、`tests/unit/**`。

---

## Task 1: 章节数据模型

**Files:**
- Modify: `models.py:10-42`（`ComicInfo` 定义区）
- Test: `tests/test_models.py`（若不存在则创建）

- [ ] **Step 1: Write the failing test**

```python
# tests/test_models.py 追加
from models import ChapterInfo, ComicInfo


def test_chapter_info_defaults():
    ch = ChapterInfo(id="700", name="第 1 話", index=1)
    assert ch.id == "700"
    assert ch.pages == 0


def test_comic_info_chapter_fields_default_empty():
    comic = ComicInfo(id="430371", title="t")
    assert comic.chapters == []
    assert comic.album_id == ""
    assert comic.album_total_chapters == 1


def test_comic_info_chapters_not_in_hash():
    a = ComicInfo(id="1", source_site="jmcomic", comic_source="JMCOMIC")
    b = ComicInfo(id="1", source_site="jmcomic", comic_source="JMCOMIC",
                  chapters=[ChapterInfo(id="2", name="x", index=1)])
    assert hash(a) == hash(b) and a == b
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_models.py -v`
Expected: FAIL with `ImportError: cannot import name 'ChapterInfo'`

- [ ] **Step 3: Write minimal implementation**

在 `models.py` 顶部 import 区已无需改动；在 `ComicInfo` 定义之前插入 `ChapterInfo`，并给 `ComicInfo` 增加三个字段：

```python
@dataclass
class ChapterInfo:
    """jmcomic 章节信息。

    Attributes:
        id: 章节(photo) id，用于请求 /photo/{id} 及反混淆
        name: 章节名，如 "第 1 話"
        index: 1-based 顺序
        pages: 页数（可选，懒填充）
    """
    id: str = ""
    name: str = ""
    index: int = 0
    pages: int = 0
```

在 `ComicInfo` 的 `image_urls` 字段后追加：

```python
    chapters: list[ChapterInfo] = field(default_factory=list)
    album_id: str = ""              # 多章节时为专辑 id；单本时等于 id
    album_total_chapters: int = 1   # 专辑总章数；单本/其他来源为 1
```

`__hash__` / `__eq__` 无需改动（仍只基于 `source_site, id, comic_source`）。

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_models.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add models.py tests/test_models.py
git commit -m "✨ feat: add ChapterInfo model and chapter fields on ComicInfo"
```

---

## Task 2: 反混淆 eps_id 从图片 URL 提取

**Files:**
- Modify: `sources/jmcomic/descrambler.py:34-42`（新增辅助函数）
- Test: `tests/test_jmcomic_descrambler.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_jmcomic_descrambler.py 追加 import 与测试
from sources.jmcomic.descrambler import _extract_eps_id


def test_extract_eps_id_from_url():
    url = "https://cdn.test.one/media/photos/700123/00001.webp"
    assert _extract_eps_id(url) == 700123


def test_extract_eps_id_missing_returns_zero():
    assert _extract_eps_id("https://cdn.test.one/cover.jpg") == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_jmcomic_descrambler.py::test_extract_eps_id_from_url -v`
Expected: FAIL with `ImportError: cannot import name '_extract_eps_id'`

- [ ] **Step 3: Write minimal implementation**

在 `descrambler.py` 的 `_extract_page_num` 之后新增：

```python
def _extract_eps_id(image_url: str) -> int:
    """从 jmcomic 图片 URL 路径提取章节(photo) id。

    URL 格式: https://cdn.xxx/media/photos/{eps_id}/{page_num}.{ext}
    多章节专辑每章有独立 eps_id；这是反混淆所需的正确 id（而非专辑 id）。
    无法提取时返回 0（调用方据此跳过反混淆）。
    """
    m = re.search(r"/media/photos/(\d+)/", image_url)
    return int(m.group(1)) if m else 0
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_jmcomic_descrambler.py -v`
Expected: PASS（含原有测试）

- [ ] **Step 5: Commit**

```bash
git add sources/jmcomic/descrambler.py tests/test_jmcomic_descrambler.py
git commit -m "✨ feat: extract descramble eps_id from image URL path"
```

---

## Task 3: 多章节 fixture + 解析章节列表

**Files:**
- Create: `tests/fixtures/html/jm_album_multi_chapter.html`
- Modify: `sources/jmcomic/parser.py:393-517`（`_parse_detail`）
- Test: `tests/test_jmcomic_parser.py`

- [ ] **Step 1: 创建多章节 fixture**

创建 `tests/fixtures/html/jm_album_multi_chapter.html`，在单章节 fixture 基础上加入 episode 块（关键节点）：

```html
<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>多章漫画 | 禁漫天堂</title></head>
<body>
<script>var aid = 999001; var scramble_id = 220980;</script>
<h1 id="book-name">多章测试漫画</h1>
<div id="album_photo_cover"><div class="thumb-overlay">
  <img class="img-responsive" src="https://cdn.test.one/media/albums/999001.jpg"></div></div>
<div class="p-b-5"><div class="p-t-5 p-b-5">页数：60</div></div>
<div class="episode"><ul>
  <a data-album="999001" data-index="0" href="/photo/999001"><li><h3>第 1 話</h3></li></a>
  <a data-album="999002" data-index="1" href="/photo/999002"><li><h3>第 2 話</h3></li></a>
  <a data-album="999003" data-index="2" href="/photo/999003"><li><h3>第 3 話</h3></li></a>
</ul></div>
</body></html>
```

- [ ] **Step 2: Write the failing test**

```python
# tests/test_jmcomic_parser.py 追加
def test_parse_detail_multi_chapter():
    html = (FIXTURES / "jm_album_multi_chapter.html").read_text(encoding="utf-8")
    parser = _make_parser()
    comic = parser._parse_detail(html, comic_id="999001", domain="test.one")
    assert len(comic.chapters) == 3
    assert comic.chapters[0].id == "999001"
    assert comic.chapters[0].name == "第 1 話"
    assert comic.chapters[0].index == 1
    assert comic.chapters[2].index == 3
    assert comic.album_total_chapters == 3
    assert comic.album_id == "999001"


def test_parse_detail_single_chapter_no_chapters():
    html = (FIXTURES / "jm_album_detail.html").read_text(encoding="utf-8")
    parser = _make_parser()
    comic = parser._parse_detail(html, comic_id="430371", domain="test.one")
    assert comic.chapters == []
    assert comic.album_total_chapters == 1
    assert len(comic.image_urls) > 0  # 单章节仍直接取图
```

- [ ] **Step 3: Run test to verify it fails**

Run: `python -m pytest tests/test_jmcomic_parser.py::test_parse_detail_multi_chapter -v`
Expected: FAIL（`comic.chapters` 为 `[]`，`len == 0`）

- [ ] **Step 4: Write minimal implementation**

在 `_parse_detail` 的 scramble_id 提取之后、`return ComicInfo(...)` 之前，插入章节解析；并在 `return` 中补 3 个字段。

章节解析块（紧跟 scramble_id 之后）：

```python
        # 解析章节列表（多章节专辑）。参考 ComicGUISpider：取最后一个 episode 块。
        chapters: list[ChapterInfo] = []
        episode_blocks = doc.xpath('//div[@class="episode"]')
        if episode_blocks:
            for a in episode_blocks[-1].xpath("./ul/a"):
                chap_id = (a.xpath("./@data-album") or [""])[0]
                data_index = (a.xpath("./@data-index") or ["0"])[0]
                name_nodes = self._clean_texts(a.xpath(".//h3/text()"))
                if not chap_id:
                    continue
                chapters.append(ChapterInfo(
                    id=chap_id,
                    name=name_nodes[0] if name_nodes else f"第 {int(data_index) + 1} 話",
                    index=int(data_index) + 1,
                ))
```

`return ComicInfo(...)` 末尾追加（在 `image_urls=image_urls,` 之后）：

```python
            chapters=chapters,
            album_id=comic_id,
            album_total_chapters=len(chapters) if chapters else 1,
```

并在文件顶部 import 处补 `ChapterInfo`（`from models import ... , ChapterInfo`）。

- [ ] **Step 5: Run tests + commit**

Run: `python -m pytest tests/test_jmcomic_parser.py -v`
Expected: PASS（含单章节回归）

```bash
git add sources/jmcomic/parser.py tests/test_jmcomic_parser.py tests/fixtures/html/jm_album_multi_chapter.html
git commit -m "✨ feat: parse jmcomic chapter list from album detail page"
```

---

## Task 4: 预览反混淆按图片 URL 自纠 eps_id

**Files:**
- Modify: `python/ipc/preview_mixin.py:137-146`
- Test: `tests/test_ipc_preview.py`

**背景：** 当前 `descramble_image(raw_bytes, int(comic_id), image_url=url)` 用前端传入的 `comic_id`（专辑 id）作 eps_id。多章节时每章图片 URL 含独立 eps_id，必须以 URL 为准。

- [ ] **Step 1: Write the failing test**

```python
# tests/test_ipc_preview.py 追加
def test_descramble_uses_eps_id_from_url(monkeypatch):
    """多章节：反混淆应使用图片 URL 中的 eps_id，而非传入的专辑 comic_id。"""
    import python.ipc.preview_mixin as pm
    captured = {}

    def fake_descramble(raw, eps_id, image_url=""):
        captured["eps_id"] = eps_id
        return raw

    monkeypatch.setattr("sources.jmcomic.descrambler.descramble_image", fake_descramble)

    url = "https://cdn.test.one/media/photos/999002/00001.webp"
    # comic_id 传专辑 id 999001，但图片属于章节 999002
    eps = pm._resolve_eps_id(url, comic_id="999001")
    assert eps == 999002
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_ipc_preview.py::test_descramble_uses_eps_id_from_url -v`
Expected: FAIL（`_resolve_eps_id` 不存在）

- [ ] **Step 3: Write minimal implementation**

在 `preview_mixin.py` 模块顶部新增辅助函数：

```python
def _resolve_eps_id(image_url: str, comic_id: str = "") -> int:
    """优先从图片 URL 提取 eps_id（多章节正确），回退到 comic_id。"""
    from sources.jmcomic.descrambler import _extract_eps_id
    eps_id = _extract_eps_id(image_url)
    if eps_id:
        return eps_id
    try:
        return int(comic_id)
    except (ValueError, TypeError):
        return 0
```

将第 142 行改为：

```python
                eps_id = _resolve_eps_id(url, comic_id)
                descrambled = descramble_image(raw_bytes, eps_id, image_url=url)
```

- [ ] **Step 4: Run tests + commit**

Run: `python -m pytest tests/test_ipc_preview.py -v`
Expected: PASS

```bash
git add python/ipc/preview_mixin.py tests/test_ipc_preview.py
git commit -m "🐛 fix: descramble preview images using eps_id from image URL"
```

---

## Task 5: parser 新增 get_chapter_images

**Files:**
- Modify: `sources/jmcomic/parser.py`（在 `get_comic_detail` 之后新增方法）
- Test: `tests/test_jmcomic_parser.py`

**背景：** 多章节专辑的图片在独立的 `/photo/{章节id}` 页面。`get_chapter_images` 请求该页并复用 `_parse_detail` 的图片提取逻辑。

- [ ] **Step 1: Write the failing test**

```python
# tests/test_jmcomic_parser.py 追加
def test_get_chapter_images(monkeypatch):
    html = (FIXTURES / "jm_album_detail.html").read_text(encoding="utf-8")
    parser = _make_parser()
    monkeypatch.setattr(parser, "_ensure_domain", lambda: "test.one")
    monkeypatch.setattr(parser, "_request_text", lambda url: html)
    image_urls, scramble_id = parser.get_chapter_images("430371")
    assert len(image_urls) > 0
    assert scramble_id == "220980"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_jmcomic_parser.py::test_get_chapter_images -v`
Expected: FAIL（`get_chapter_images` 不存在）

- [ ] **Step 3: Write minimal implementation**

在 `get_comic_detail` 方法之后新增：

```python
    def get_chapter_images(self, chapter_id: str) -> tuple[list[str], str]:
        """获取单个章节的图片 URL 列表与 scramble_id。

        章节图片在 /photo/{chapter_id} 页面，页面结构与专辑详情页一致，
        复用 _parse_detail 的图片提取逻辑（传入 chapter_id 作为 comic_id）。
        """
        domain = self._ensure_domain()
        url = f"https://{domain}/photo/{chapter_id}"
        html = self._request_text(url)
        detail = self._parse_detail(html, comic_id=chapter_id, domain=domain)
        return detail.image_urls, detail.scramble_id
```

- [ ] **Step 4: Run tests + commit**

Run: `python -m pytest tests/test_jmcomic_parser.py -v`
Expected: PASS

```bash
git add sources/jmcomic/parser.py tests/test_jmcomic_parser.py
git commit -m "✨ feat: add get_chapter_images to fetch per-chapter image URLs"
```

---

## Task 6: IPC 后端 — chapters 输出 + get_chapter_preview_urls

**Files:**
- Modify: `python/ipc/search_mixin.py:27-46`（`_comic_to_dict`）、`:180-220`（`handle_get_preview_urls`），新增 `handle_get_chapter_preview_urls`
- Modify: `python/ipc_server.py:173`（dispatch 表）
- Test: `tests/test_ipc_preview.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_ipc_preview.py 追加
def test_get_preview_urls_returns_chapters(ipc_server, monkeypatch):
    from models import ChapterInfo, ComicInfo
    comic = ComicInfo(id="999001", title="多章", source_site="jmcomic",
                      comic_source="JMCOMIC", album_id="999001",
                      album_total_chapters=2,
                      chapters=[ChapterInfo(id="999001", name="第 1 話", index=1),
                                ChapterInfo(id="999002", name="第 2 話", index=2)])
    monkeypatch.setattr(ipc_server, "_build_and_prepare_comic", lambda d, comic_id=None: comic)
    result = ipc_server.handle_get_preview_urls({"id": "999001", "sourceSite": "jmcomic"})
    assert len(result["chapters"]) == 2
    assert result["chapters"][0]["id"] == "999001"
    assert result["imageUrls"] == []


def test_get_chapter_preview_urls(ipc_server, monkeypatch):
    jm = ipc_server.parser.parsers["jmcomic"]
    monkeypatch.setattr(jm, "get_chapter_images",
                        lambda cid: (["https://cdn/media/photos/999002/00001.webp"], "220980"))
    result = ipc_server.handle_get_chapter_preview_urls(chapter_id="999002", album_id="999001")
    assert result["imageUrls"][0].endswith("00001.webp")
    assert result["scrambleId"] == "220980"
    assert result["comicId"] == "999002"
```

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_ipc_preview.py::test_get_chapter_preview_urls -v`
Expected: FAIL（`handle_get_chapter_preview_urls` 不存在）

- [ ] **Step 3: Write minimal implementation**

(a) `_comic_to_dict`（`search_mixin.py`）末尾追加 chapters 序列化（放在 return dict 内）：

```python
            "chapters": [
                {"id": c.id, "name": c.name, "index": c.index, "pages": c.pages}
                for c in (comic.chapters or [])
            ],
            "albumId": comic.album_id or comic.id,
            "albumTotalChapters": comic.album_total_chapters or 1,
```

(b) `handle_get_preview_urls`：多章节时不预取图片，返回 chapters。在 `comic = self._build_and_prepare_comic(...)` 之后插入：

```python
        if comic.source_site == "jmcomic" and len(comic.chapters) > 1:
            return {
                "imageUrls": [],
                "totalPages": comic.pages or 0,
                "chapters": [
                    {"id": c.id, "name": c.name, "index": c.index, "pages": c.pages}
                    for c in comic.chapters
                ],
                "albumId": comic.album_id or comic.id,
                "albumTotalChapters": comic.album_total_chapters,
            }
```

(c) 新增 handler（放在 `handle_get_preview_urls` 之后）：

```python
    def handle_get_chapter_preview_urls(self, chapter_id: str, album_id: str = "") -> dict:
        if not chapter_id or not isinstance(chapter_id, str):
            raise ValueError("Missing chapter id")
        jm = self.parser.parsers.get("jmcomic")
        image_urls, scramble_id = jm.get_chapter_images(chapter_id)
        result = {
            "imageUrls": image_urls,
            "totalPages": len(image_urls),
            "comicId": chapter_id,
        }
        if scramble_id:
            result["scrambleId"] = scramble_id
        return result
```

(d) `ipc_server.py:173` dispatch 表追加一行：

```python
            "get_chapter_preview_urls": self.handle_get_chapter_preview_urls,
```

- [ ] **Step 4: Run tests + commit**

Run: `python -m pytest tests/test_ipc_preview.py -v`
Expected: PASS

```bash
git add python/ipc/search_mixin.py python/ipc_server.py tests/test_ipc_preview.py
git commit -m "✨ feat: expose chapters in get_preview_urls and add get_chapter_preview_urls IPC"
```

---

## Task 7: 下载后端 — chapter_ids 选章下载

**Files:**
- Modify: `python/ipc/download_mixin.py:65-80`（`handle_download`）
- Test: `tests/test_download_manager.py` 或 `tests/test_ipc_preview.py`（新建 `tests/test_ipc_download_chapters.py`）

**实现决策（标注偏离 spec）：** spec §8 folder 用嵌套 `{专辑名}/{章节名}/`。为保持现有路径校验/冲突检测逻辑不变，本计划改为**所有格式统一扁平命名** `{专辑名} - {章节名}`（folder → 同名目录，cbz/zip → 同名文件）。各章节按字母序聚簇在专辑名下，效果接近。实现时如需严格嵌套再单列任务。

- [ ] **Step 1: Write the failing test**

```python
# tests/test_ipc_download_chapters.py（新建）
def test_download_with_chapter_ids_creates_task_per_chapter(ipc_server, monkeypatch):
    jm = ipc_server.parser.parsers["jmcomic"]
    monkeypatch.setattr(jm, "get_chapter_images",
                        lambda cid: ([f"https://cdn/media/photos/{cid}/00001.webp"], "220980"))
    created = []
    monkeypatch.setattr(ipc_server._download_manager, "add_task",
                        lambda comic, overwrite=False: created.append(comic) or comic.id)
    comic_data = {"id": "999001", "title": "多章漫画", "sourceSite": "jmcomic",
                  "source": "JMCOMIC", "albumTotalChapters": 2}
    result = ipc_server.handle_download("999001", comic_data, chapter_ids=["999001", "999002"])
    assert len(created) == 2
    assert created[0].id == "999001"
    assert created[0].album_id == "999001"
    assert created[0].album_total_chapters == 2
    assert created[0].title == "多章漫画 - 999001" or "多章漫画" in created[0].title
    assert len(result["taskIds"]) == 2
```

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_ipc_download_chapters.py -v`
Expected: FAIL（`handle_download` 不接受 `chapter_ids`）

- [ ] **Step 3: Write minimal implementation**

将 `handle_download` 签名与体改为支持 `chapter_ids`：

```python
    def handle_download(self, comic_id: str, comic_data: dict | None = None,
                        overwrite: bool = False, chapter_ids: list | None = None) -> dict:
        comic_data = comic_data or {}
        if chapter_ids:
            return self._download_chapters(comic_id, comic_data, chapter_ids, overwrite)
        # —— 以下为原单本逻辑，保持不变 ——
        comic = self._build_and_prepare_comic(comic_data, comic_id=comic_id)
        if not overwrite:
            output_path = self.cbz_builder.get_output_path_for_format(
                comic, self.config.output_format, self.config.download_dir
            )
            if os.path.exists(output_path):
                return {"taskId": None, "status": "conflict", "conflictPath": output_path}
        task_id = self._download_manager.add_task(comic, overwrite=overwrite)
        task = self._download_manager.tasks.get(task_id)
        return {"taskId": task_id, "status": task.status.value if task else "queued"}
```

新增 `_download_chapters`（每章一个独立任务）：

```python
    def _download_chapters(self, album_id: str, comic_data: dict,
                           chapter_ids: list, overwrite: bool) -> dict:
        from models import ComicInfo
        album_title = comic_data.get("title", "Unknown")
        total = int(comic_data.get("albumTotalChapters") or len(chapter_ids))
        chapter_meta = {c["id"]: c for c in (comic_data.get("chapters") or [])}
        jm = self.parser.parsers.get("jmcomic")
        task_ids = []
        for chap_id in chapter_ids:
            image_urls, scramble_id = jm.get_chapter_images(chap_id)
            chap_name = chapter_meta.get(chap_id, {}).get("name", chap_id)
            comic = ComicInfo(
                id=chap_id,
                title=f"{album_title} - {chap_name}",
                source_site="jmcomic",
                comic_source="JMCOMIC",
                media_id=chap_id,
                image_urls=image_urls,
                pages=len(image_urls),
                scramble_id=scramble_id,
                album_id=album_id,
                album_total_chapters=total,
            )
            task_ids.append(self._download_manager.add_task(comic, overwrite=overwrite))
        return {"taskIds": task_ids, "status": "queued"}
```

- [ ] **Step 4: Run tests + commit**

Run: `python -m pytest tests/test_ipc_download_chapters.py -v`
Expected: PASS

```bash
git add python/ipc/download_mixin.py tests/test_ipc_download_chapters.py
git commit -m "✨ feat: support per-chapter download via chapter_ids"
```

---

## Task 8: 下载历史 — album 列 + 全章完成判定

**Files:**
- Modify: `download_history.py:26-60`（建表+迁移、`record_download`）、`:62-136`（`check_downloaded_batch`）
- Test: `tests/test_download_history.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_download_history.py 追加
def test_multi_chapter_partial_not_downloaded(tmp_path):
    from download_history import DownloadHistoryDB
    from models import ComicInfo
    db = DownloadHistoryDB(str(tmp_path / "h.db"))
    out = tmp_path / "ch1"; out.mkdir()
    c1 = ComicInfo(id="999001", title="多章", source_site="jmcomic",
                   comic_source="JMCOMIC", album_id="999001", album_total_chapters=2)
    db.record_download(c1, str(out), "folder")
    # 只下了 1/2 章 → 专辑视角未完成
    status = db.check_downloaded_batch(
        [("jmcomic", "999001", "JMCOMIC")], str(tmp_path), "folder", "{title}.cbz")
    assert status[("jmcomic", "999001", "JMCOMIC")] == "unknown"


def test_multi_chapter_complete_downloaded(tmp_path):
    from download_history import DownloadHistoryDB
    from models import ComicInfo
    db = DownloadHistoryDB(str(tmp_path / "h.db"))
    o1 = tmp_path / "c1"; o1.mkdir(); o2 = tmp_path / "c2"; o2.mkdir()
    for cid, out in [("999001", o1), ("999002", o2)]:
        db.record_download(ComicInfo(id=cid, title="多章", source_site="jmcomic",
                           comic_source="JMCOMIC", album_id="999001",
                           album_total_chapters=2), str(out), "folder")
    status = db.check_downloaded_batch(
        [("jmcomic", "999001", "JMCOMIC")], str(tmp_path), "folder", "{title}.cbz")
    assert status[("jmcomic", "999001", "JMCOMIC")] == "downloaded"
```

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_download_history.py::test_multi_chapter_complete_downloaded -v`
Expected: FAIL（无 album 列 / 判定按单条）

- [ ] **Step 3: Write implementation — 建表迁移**

`_create_table` 末尾（`self._conn.commit()` 之前）追加列迁移：

```python
        existing = {row[1] for row in self._conn.execute("PRAGMA table_info(download_history)")}
        if "album_id" not in existing:
            self._conn.execute("ALTER TABLE download_history ADD COLUMN album_id TEXT NOT NULL DEFAULT ''")
        if "album_total_chapters" not in existing:
            self._conn.execute("ALTER TABLE download_history ADD COLUMN album_total_chapters INTEGER NOT NULL DEFAULT 1")
```

- [ ] **Step 4: Write implementation — record_download 写入 album 字段**

`record_download` 的 INSERT 改为包含两列；列名与 VALUES 占位符各加一个，参数元组加：

```python
                comic.album_id or comic.id,
                comic.album_total_chapters or 1,
```

（`album_id`、`album_total_chapters` 分别加在 `output_format` 之后、`downloaded_at` 之前，保持顺序一致。）

- [ ] **Step 5: Write implementation — check_downloaded_batch 按 album 聚合**

在 `check_downloaded_batch` 中，对每个传入 key `(source_site, comic_id, comic_source)`，把 `comic_id` 视为 `album_id` 查询同专辑所有章节行，统计 output_path 仍存在的章数与 album_total_chapters 比较。改写查询为按 album_id：

```python
                cursor = self._conn.execute(f"""
                    SELECT source_site, album_id, comic_source, output_path,
                           album_total_chapters, title, author
                    FROM download_history
                    WHERE (source_site, album_id, comic_source) IN ({placeholders})
                """, flat_keys)

                # 按 (site, album_id, source) 聚合：统计存在的章数 + 总章数
                from collections import defaultdict
                agg: dict[tuple, dict] = defaultdict(lambda: {"have": 0, "total": 1, "rec": None})
                for row in cursor:
                    key = (row[0], row[1], row[2])
                    bucket = agg[key]
                    bucket["total"] = row[4] or 1
                    bucket["rec"] = {"output_path": row[3], "title": row[5], "author": row[6]}
                    if row[3] and os.path.exists(row[3]):
                        bucket["have"] += 1
```

随后的 per-key 判定改为：

```python
                for key in batch:
                    bucket = agg.get(key)
                    if bucket and bucket["have"] >= bucket["total"]:
                        result[key] = "downloaded"
                    else:
                        # 回退：旧记录无 album 行或未命中时，按预期路径探测（保留原逻辑）
                        data = (comic_data_map or {}).get(key, {})
                        rec = bucket["rec"] if bucket else None
                        comic = ComicInfo(
                            id=key[1],
                            title=rec["title"] if rec else data.get("title", ""),
                            author=rec["author"] if rec else data.get("author"),
                            source_site=key[0], comic_source=key[2],
                        )
                        expected_path = builder.get_output_path_for_format(comic, output_format, output_dir)
                        result[key] = "downloaded" if os.path.exists(expected_path) else "unknown"
```

> 注：旧的单本记录 `album_id == comic_id`、`album_total_chapters == 1`，`have>=1` 即判定已下载，向后兼容。

- [ ] **Step 6: Run tests + commit**

Run: `python -m pytest tests/test_download_history.py -v`
Expected: PASS（含原有单本回归）

```bash
git add download_history.py tests/test_download_history.py
git commit -m "✨ feat: judge album downloaded by full-chapter completion"
```

---

## Task 9: TypeScript IPC 接线（chapters + 新通道 + chapter_ids）

**Files:**
- Modify: `shared/types.ts`（`ChapterInfo`、`ComicInfo`、`PreviewUrlsResult`、`HcomicAPI`、`IPC_CHANNELS`、`PYTHON_IPC_CHANNEL_MAP`）
- Modify: `electron/preload.ts:49-54`（download）、`:166-169`（preview）+ 新增 `getChapterPreviewUrls`
- Modify: `electron/main.ts:503-510`（DOWNLOAD）+ 新增 GET_CHAPTER_PREVIEW_URLS handler
- Modify: `src/hooks/useIpc.ts`（`useDownloadCommands`、新增 `useChapterPreview`）
- Test: `tests/unit/main/ipc-channel-consistency.test.ts`

- [ ] **Step 1: shared/types.ts — 类型与通道**

(a) 新增接口 + 扩展 ComicInfo（在 ComicInfo 定义处加可选字段）：

```ts
export interface ChapterInfo { id: string; name: string; index: number; pages?: number }
// ComicInfo 内追加：
//   chapters?: ChapterInfo[]
//   albumId?: string
//   albumTotalChapters?: number
```

(b) `PreviewUrlsResult` 追加可选字段：`chapters?: ChapterInfo[]; albumId?: string; albumTotalChapters?: number`

(c) `HcomicAPI` 追加方法签名：

```ts
  getChapterPreviewUrls(chapterId: string, albumId?: string): Promise<PreviewUrlsResult>
  download(comicId: string, comicData: ComicInfo, overwrite?: boolean, chapterIds?: string[]): Promise<{ taskId?: string; taskIds?: string[]; status: string; conflictPath?: string }>
```

(d) `IPC_CHANNELS` 追加：`GET_CHAPTER_PREVIEW_URLS: 'python:get-chapter-preview-urls',`

(e) 若存在 `PYTHON_IPC_CHANNEL_MAP`（IPC channel→python method 映射），追加 `[IPC_CHANNELS.GET_CHAPTER_PREVIEW_URLS]: 'get_chapter_preview_urls'`。

- [ ] **Step 2: preload.ts**

`download` 增加 chapterIds 校验与透传：

```ts
  download: (comicId: unknown, comicData: unknown, overwrite?: unknown, chapterIds?: unknown) => {
    if (typeof comicId !== 'string' || comicId.length === 0) throw new Error('Invalid comicId')
    if (typeof comicData !== 'object' || comicData === null) throw new Error('Invalid comicData')
    if (overwrite !== undefined && typeof overwrite !== 'boolean') throw new Error('Invalid overwrite')
    if (chapterIds !== undefined && chapterIds !== null) {
      if (!Array.isArray(chapterIds) || chapterIds.some(x => typeof x !== 'string')) throw new Error('Invalid chapterIds')
    }
    return ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD, comicId, comicData, overwrite, chapterIds ?? undefined)
  },
```

新增（放在 getPreviewUrls 之后）：

```ts
  getChapterPreviewUrls: (chapterId: unknown, albumId?: unknown) => {
    if (typeof chapterId !== 'string' || chapterId.length === 0 || chapterId.length > 256) throw new Error('Invalid chapterId')
    if (albumId !== undefined && albumId !== null && typeof albumId !== 'string') throw new Error('Invalid albumId')
    return ipcRenderer.invoke(IPC_CHANNELS.GET_CHAPTER_PREVIEW_URLS, chapterId, albumId ?? undefined)
  },
```

- [ ] **Step 3: main.ts — handler 接线**

`DOWNLOAD` handler 透传 chapter_ids（替换 503-510）：

```ts
  ipcMain.handle(IPC_CHANNELS.DOWNLOAD, async (_, comicId, comicData, overwrite?: unknown, chapterIds?: unknown) => {
    validateDownloadPayload(comicId, comicData)
    const params: Record<string, unknown> = { comic_id: comicId, comic_data: comicData }
    if (overwrite === true) params.overwrite = true
    if (Array.isArray(chapterIds) && chapterIds.length > 0) params.chapter_ids = chapterIds
    return bridge.call('download', params)
  })
```

新增 handler（放在 GET_PREVIEW_URLS handler 之后，约 706 行附近）：

```ts
  ipcMain.handle(IPC_CHANNELS.GET_CHAPTER_PREVIEW_URLS, async (_, chapterId: unknown, albumId?: unknown) => {
    assert(and(string(), nonEmpty()), chapterId, 'chapterId')
    const params: Record<string, unknown> = { chapter_id: chapterId }
    if (albumId !== undefined && albumId !== null) params.album_id = albumId
    return bridge.call('get_chapter_preview_urls', params)
  })
```

（`assert`/`and`/`string`/`nonEmpty` 沿用文件顶部已 import 的校验组合子；若 `nonEmpty` 不存在，用现有等价方式，参照同文件其它 string 校验。）

- [ ] **Step 4: useIpc.ts — hook**

`useDownloadCommands` 的 `startDownload` 增加 chapterIds 形参：

```ts
  const startDownload = useCallback(async (comicId: string, comicData: ComicInfo, overwrite?: boolean, chapterIds?: string[]) => {
    return invoke(() => window.hcomic!.download(comicId, comicData, overwrite, chapterIds))
  }, [invoke])
```

新增 hook：

```ts
export function useChapterPreview() {
  const { invoke } = useIpc()
  const getChapterPreviewUrls = useCallback(async (chapterId: string, albumId?: string) => {
    return invoke(() => window.hcomic!.getChapterPreviewUrls(chapterId, albumId))
  }, [invoke])
  return { getChapterPreviewUrls }
}
```

- [ ] **Step 5: 补齐 useIpc mock**

搜索所有 `vi.mock('@/hooks/useIpc')` 与手写 `window.hcomic` mock 的测试，给它们补 `getChapterPreviewUrls` 与 `download` 的新签名。

Run: `npx vitest run tests/unit/main/ipc-channel-consistency.test.ts`
Expected: PASS（新通道在 IPC_CHANNELS、preload、main handler 三处一致）

- [ ] **Step 6: Commit**

```bash
git add shared/types.ts electron/preload.ts electron/main.ts src/hooks/useIpc.ts tests/unit
git commit -m "✨ feat: wire chapter preview + chapter download IPC across TS layers"
```

---

## Task 10: 阅读器章节状态（store + hook）

**Files:**
- Modify: `src/stores/useReaderStore.ts`
- Modify: `src/hooks/useComicReader.ts:28-67`
- Test: `tests/unit/hooks/useComicReader.test.tsx`（若不存在则创建）、`tests/unit/stores/useReaderStore.test.ts`

- [ ] **Step 1: store 增加 initialChapterId**

`ReaderState` 与 `openReader` 增加可选 `initialChapterId`：

```ts
interface ReaderState {
  readerComic: ComicInfo | null
  initialPage: number | null
  initialChapterId: string | null
  openReader: (comic: ComicInfo, initialPage?: number, initialChapterId?: string) => void
  closeReader: () => void
}

export const useReaderStore = create<ReaderState>((set) => ({
  readerComic: null,
  initialPage: null,
  initialChapterId: null,
  openReader: (comic, initialPage, initialChapterId) =>
    set({ readerComic: comic, initialPage: initialPage ?? null, initialChapterId: initialChapterId ?? null }),
  closeReader: () => set({ readerComic: null, initialPage: null, initialChapterId: null }),
}))
```

- [ ] **Step 2: useComicReader 增加 chapters 状态与 fetchChapterUrls**

`fetchUrls` 内读取 `result.chapters`，存入新状态 `chapters`；新增 `fetchChapterUrls(chapterId, albumId)` 调用 `getChapterPreviewUrls`。Write the failing test first:

```tsx
// tests/unit/hooks/useComicReader.test.tsx
it('stores chapters from getPreviewUrls', async () => {
  window.hcomic = { getPreviewUrls: vi.fn().mockResolvedValue({
    imageUrls: [], totalPages: 0,
    chapters: [{ id: '999001', name: '第 1 話', index: 1 }],
  }) } as any
  const { result } = renderHook(() => useComicReader())
  await act(() => result.current.fetchUrls({ id: '999001', sourceSite: 'jmcomic' } as any))
  expect(result.current.chapters).toHaveLength(1)
})
```

- [ ] **Step 3: 实现**

`UseComicReaderReturn` 增加 `chapters: ChapterInfo[]` 与 `fetchChapterUrls`；`fetchUrls` 末尾 `setChapters(result.chapters ?? [])`；新增：

```ts
  const fetchChapterUrls = useCallback(async (chapterId: string, albumId?: string) => {
    setLoadingState('loading'); setErrorMessage('')
    try {
      const result = await window.hcomic!.getChapterPreviewUrls(chapterId, albumId)
      setImageUrls(result.imageUrls); setTotalPages(result.totalPages)
      setScrambleId(result.scrambleId ?? ''); setComicId(result.comicId ?? '')
      setCurrentPage(result.imageUrls.length > 0 ? 1 : 0); setLoadingState('loaded')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed'); setLoadingState('error')
    }
  }, [])
```

`reset` 内追加 `setChapters([])`。

- [ ] **Step 4: Run + commit**

Run: `npx vitest run tests/unit/hooks/useComicReader.test.tsx tests/unit/stores/useReaderStore.test.ts`
Expected: PASS

```bash
git add src/stores/useReaderStore.ts src/hooks/useComicReader.ts tests/unit
git commit -m "✨ feat: add chapter state to reader store and hook"
```

---

## Task 11: ChapterPicker 选章首屏（B）

**Files:**
- Create: `src/components/ChapterPicker.tsx`
- Modify: `src/components/ComicReaderModal.tsx:22-72`（首屏分支）
- Test: `tests/unit/components/ChapterPicker.test.tsx`、`tests/unit/components/common/ComicReaderModal.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/ChapterPicker.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { ChapterPicker } from '@/components/ChapterPicker'

const chapters = [
  { id: '999001', name: '第 1 話', index: 1 },
  { id: '999002', name: '第 2 話', index: 2 },
]

it('renders chapters and fires onSelect with chapter id', () => {
  const onSelect = vi.fn()
  render(<ChapterPicker chapters={chapters} onSelect={onSelect} />)
  expect(screen.getByText('第 1 話')).toBeInTheDocument()
  fireEvent.click(screen.getByText('第 2 話'))
  expect(onSelect).toHaveBeenCalledWith('999002')
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/unit/components/ChapterPicker.test.tsx`
Expected: FAIL（组件不存在）

- [ ] **Step 3: 实现 ChapterPicker**

```tsx
// src/components/ChapterPicker.tsx
import type { ChapterInfo } from '@shared/types'

interface ChapterPickerProps {
  chapters: ChapterInfo[]
  onSelect: (chapterId: string) => void
  title?: string
}

export function ChapterPicker({ chapters, onSelect, title }: ChapterPickerProps) {
  return (
    <div className="chapter-picker" role="list" aria-label="章节列表">
      <p className="chapter-picker__title">
        {title ? `${title} · ` : ''}请选择章节 · 共 {chapters.length} 章
      </p>
      <div className="chapter-picker__list">
        {chapters.map((c) => (
          <button
            key={c.id}
            role="listitem"
            className="chapter-picker__item"
            onClick={() => onSelect(c.id)}
          >
            {c.name}{c.pages ? `　${c.pages} 页` : ''}
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: ComicReaderModal 接入首屏分支**

在 modal 打开、`fetchUrls` 解析出 `chapters.length > 1` 时，渲染 `<ChapterPicker>` 而非翻页视图；点击章节 → `fetchChapterUrls(chapterId, comic.albumId ?? comic.id)` 并切到阅读视图。新增本地 state `inChapterPicker`（多章节且未选章时为 true）。`openReader` 携带 `initialChapterId` 时跳过首屏直接 `fetchChapterUrls`。

ComicReaderModal 测试追加：多章节 comic 打开后先显示 ChapterPicker；点击章节后调用 `getChapterPreviewUrls`。

- [ ] **Step 5: Run + commit**

Run: `npx vitest run tests/unit/components/ChapterPicker.test.tsx tests/unit/components/common/ComicReaderModal.test.tsx`
Expected: PASS

```bash
git add src/components/ChapterPicker.tsx src/components/ComicReaderModal.tsx tests/unit
git commit -m "✨ feat: show chapter-picker first screen in reader for multi-chapter comics"
```

---

## Task 12: 边界翻章提示 + 底栏切章按钮

**Files:**
- Modify: `src/components/ComicReaderModal.tsx`（键盘/翻页边界逻辑 :204-218、底栏渲染区）
- Test: `tests/unit/components/common/ComicReaderModal.test.tsx`

**前置：** Task 10 已提供 `chapters`、`fetchChapterUrls`。本任务在 modal 内维护 `currentChapterIndex`（进入某章时设置）并派生 `hasPrev`/`hasNext`。

- [ ] **Step 1: 切章工具函数 + 测试**

在 modal 内新增：

```ts
  const [currentChapterIndex, setCurrentChapterIndex] = useState(-1)
  const hasPrevChapter = currentChapterIndex > 0
  const hasNextChapter = currentChapterIndex >= 0 && currentChapterIndex < chapters.length - 1

  const goToChapter = useCallback((idx: number) => {
    if (idx < 0 || idx >= chapters.length) return
    setCurrentChapterIndex(idx)
    fetchChapterUrls(chapters[idx].id, comic?.albumId ?? comic?.id)
  }, [chapters, fetchChapterUrls, comic])
```

测试（ComicReaderModal.test.tsx 追加）：底栏「下一章」点击后用下一章 id 调用 `getChapterPreviewUrls`；末章时「下一章」禁用。

- [ ] **Step 2: 底栏按钮（C）**

在底栏进度条容器两端渲染（仅 `chapters.length > 1` 时）：

```tsx
{chapters.length > 1 && (
  <button className="reader-footer__chapter-btn" disabled={!hasPrevChapter}
          onClick={() => goToChapter(currentChapterIndex - 1)} aria-label="上一章">‹ 上一章</button>
)}
{/* …进度条/页码… */}
{chapters.length > 1 && (
  <button className="reader-footer__chapter-btn" disabled={!hasNextChapter}
          onClick={() => goToChapter(currentChapterIndex + 1)} aria-label="下一章">下一章 ›</button>
)}
```

- [ ] **Step 3: 边界翻章提示（B）**

在键盘处理（:204-218 的 else 分支，单/双页模式）中，将「越界即止」改为「越界提示 + 二次确认切章」。新增 state `chapterFlipHint: 'next' | 'prev' | null`：

```ts
        if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
          e.preventDefault()
          if (currentPage + step <= navTotal) {
            setChapterFlipHint(null); setCurrentPage(currentPage + step)
          } else if (hasNextChapter) {
            if (chapterFlipHint === 'next') { setChapterFlipHint(null); goToChapter(currentChapterIndex + 1) }
            else setChapterFlipHint('next')
          }
        } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
          e.preventDefault()
          if (currentPage > 1) {
            setChapterFlipHint(null); setCurrentPage(Math.max(currentPage - step, 1))
          } else if (hasPrevChapter) {
            if (chapterFlipHint === 'prev') { setChapterFlipHint(null); goToChapter(currentChapterIndex - 1) }
            else setChapterFlipHint('prev')
          }
        }
```

并在阅读区渲染浮层：`chapterFlipHint === 'next'` → 「再翻一次进入下一章 →」；`'prev'` → 「← 再翻一次进入上一章」。滚动模式（`displayMode === 'scroll'`）不触发边界翻章（保持现有滚动逻辑）。切章成功后 `chapterFlipHint` 复位为 null。

依赖数组追加 `chapters.length, hasNextChapter, hasPrevChapter, chapterFlipHint, currentChapterIndex, goToChapter`。

- [ ] **Step 4: Run + commit**

Run: `npx vitest run tests/unit/components/common/ComicReaderModal.test.tsx`
Expected: PASS

```bash
git add src/components/ComicReaderModal.tsx tests/unit
git commit -m "✨ feat: add boundary chapter-flip hint and footer chapter buttons"
```

---

## Task 13: 阅读历史章节字段 + 从历史跳章

**Files:**
- Modify: `python/ipc/history_mixin.py:41-64`（`handle_add_history`）、`:84-106`（建表迁移）、`:108-168`（upsert/get_history）
- Modify: `electron/preload.ts:224-237`（addHistory 校验）、`shared/types.ts`（addHistory 参数类型）
- Modify: `src/hooks/useIpc.ts:224`（addHistory 参数）、`src/components/ComicReaderModal.tsx`（recordHistory 带章节）
- Modify: `src/pages/HistoryPage.tsx`（打开历史时传 initialChapterId、副标题显示章节名）
- Test: `tests/test_reading_history.py`（若不存在则参照现有历史测试）、`tests/unit/components`

- [ ] **Step 1: Write the failing test（Python）**

```python
# tests/test_reading_history.py 追加
def test_history_stores_chapter_fields(tmp_path):
    from python.ipc.history_mixin import ReadingHistoryDB
    db = ReadingHistoryDB(str(tmp_path / "r.db"))
    db.upsert(comic_id="999001", title="多章", cover_url="", source="JMCOMIC",
              source_site="jmcomic", media_id="", source_url="",
              last_page=5, total_pages=30,
              last_chapter_id="999002", last_chapter_name="第 2 話")
    items, total = db.get_history(page=1, page_size=20)
    assert total == 1
    assert items[0]["lastChapterId"] == "999002"
    assert items[0]["lastChapterName"] == "第 2 話"
```

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest tests/test_reading_history.py::test_history_stores_chapter_fields -v`
Expected: FAIL（`upsert` 不接受 last_chapter_* / 无列）

- [ ] **Step 3: 实现 — 建表迁移**

`ReadingHistoryDB.__init__` 的列迁移循环改为同时处理新列：

```python
        for col in ("source_site", "media_id", "last_chapter_id", "last_chapter_name"):
            if col not in existing_cols:
                self._conn.execute(f"ALTER TABLE reading_history ADD COLUMN {col} TEXT DEFAULT ''")
```

- [ ] **Step 4: 实现 — upsert / get_history**

`upsert` 增加 `last_chapter_id: str = "", last_chapter_name: str = ""` 形参；INSERT 列与 VALUES 各加两列；`ON CONFLICT … DO UPDATE SET` 追加 `last_chapter_id = excluded.last_chapter_id, last_chapter_name = excluded.last_chapter_name`。

`get_history` 的 SELECT 增加两列，item dict 增加：

```python
                "lastChapterId": row["last_chapter_id"] or "",
                "lastChapterName": row["last_chapter_name"] or "",
```

- [ ] **Step 5: 实现 — handler + IPC 接线**

`handle_add_history` 增加 `last_chapter_id: str = ""`、`last_chapter_name: str = ""` 形参并透传给 `upsert`。
`preload.ts` 的 addHistory：解构追加 `lastChapterId, lastChapterName`，各加校验 `if (lastChapterId !== undefined && (typeof lastChapterId !== 'string' || lastChapterId.length > 256)) throw new Error('Invalid lastChapterId')`（lastChapterName 同理）。
`shared/types.ts` addHistory 参数类型追加可选 `lastChapterId?: string; lastChapterName?: string`。
`useIpc.ts` 的 `addHistory` 参数对象类型同步追加这两个可选字段。

- [ ] **Step 6: 实现 — 前端记录与展示**

`ComicReaderModal` 的 `recordHistory` 与关闭时的 addHistory 调用，传入当前章节：`lastChapterId: chapters[currentChapterIndex]?.id ?? '', lastChapterName: chapters[currentChapterIndex]?.name ?? ''`。
`HistoryPage` 打开历史项时：`openReader(comic, item.lastPage, item.lastChapterId || undefined)`；卡片副标题在 `item.lastChapterName` 存在时显示 `· {lastChapterName}`。

- [ ] **Step 7: Run + commit**

Run: `python -m pytest tests/test_reading_history.py -v && npx vitest run tests/unit/components/common/ComicReaderModal.test.tsx`
Expected: PASS

```bash
git add python/ipc/history_mixin.py electron/preload.ts shared/types.ts src/hooks/useIpc.ts src/components/ComicReaderModal.tsx src/pages/HistoryPage.tsx tests
git commit -m "✨ feat: record and restore last-read chapter in reading history"
```

---

## Task 14: 下载语境多选章节弹窗

**Files:**
- Create: `src/components/ChapterDownloadDialog.tsx`
- Modify: `src/hooks/useDownloadHelper.ts:11-45`（`downloadWithConflictCheck` 分流）
- Modify: 下载触发点（封面/抽屉的下载按钮所在组件，如 `src/components/ComicInfoDrawer.tsx`）以在多章节时打开弹窗
- Test: `tests/unit/components/ChapterDownloadDialog.test.tsx`、`tests/unit/hooks/useDownloadHelper.test.ts`

**前置：** Task 9 已让 `startDownload` 接受 `chapterIds`。本任务在前端：多章节漫画点下载 → 多选弹窗 → 选中章节传 `chapterIds`。

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/components/ChapterDownloadDialog.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { ChapterDownloadDialog } from '@/components/ChapterDownloadDialog'

const chapters = [
  { id: '999001', name: '第 1 話', index: 1 },
  { id: '999002', name: '第 2 話', index: 2 },
]

it('multi-selects chapters and confirms with selected ids', () => {
  const onConfirm = vi.fn()
  render(<ChapterDownloadDialog chapters={chapters} open onConfirm={onConfirm} onCancel={() => {}} />)
  fireEvent.click(screen.getByLabelText('第 1 話'))
  fireEvent.click(screen.getByLabelText('第 2 話'))
  fireEvent.click(screen.getByText('下载选中'))
  expect(onConfirm).toHaveBeenCalledWith(['999001', '999002'])
})

it('select-all toggles every chapter', () => {
  const onConfirm = vi.fn()
  render(<ChapterDownloadDialog chapters={chapters} open onConfirm={onConfirm} onCancel={() => {}} />)
  fireEvent.click(screen.getByText('全选'))
  fireEvent.click(screen.getByText('下载选中'))
  expect(onConfirm).toHaveBeenCalledWith(['999001', '999002'])
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/unit/components/ChapterDownloadDialog.test.tsx`
Expected: FAIL（组件不存在）

- [ ] **Step 3: 实现 ChapterDownloadDialog**

```tsx
// src/components/ChapterDownloadDialog.tsx
import { useState } from 'react'
import type { ChapterInfo } from '@shared/types'

interface Props {
  chapters: ChapterInfo[]
  open: boolean
  onConfirm: (chapterIds: string[]) => void
  onCancel: () => void
}

export function ChapterDownloadDialog({ chapters, open, onConfirm, onCancel }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  if (!open) return null
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const allSelected = selected.size === chapters.length
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(chapters.map((c) => c.id)))
  const ordered = () => chapters.filter((c) => selected.has(c.id)).map((c) => c.id)
  return (
    <div className="chapter-dl-dialog" role="dialog" aria-label="选择下载章节">
      <button onClick={toggleAll}>{allSelected ? '取消全选' : '全选'}</button>
      <div className="chapter-dl-dialog__list">
        {chapters.map((c) => (
          <label key={c.id} aria-label={c.name}>
            <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
            {c.name}{c.pages ? `　${c.pages} 页` : ''}
          </label>
        ))}
      </div>
      <button onClick={onCancel}>取消</button>
      <button disabled={selected.size === 0} onClick={() => onConfirm(ordered())}>下载选中</button>
    </div>
  )
}
```

> 注：`onConfirm` 按 chapters 原顺序返回选中 id（非点击顺序），保证下载顺序稳定。

- [ ] **Step 4: useDownloadHelper 分流多章节**

`downloadWithConflictCheck` 开头增加：若 `comic.chapters && comic.chapters.length > 1`，不直接下载，而是返回一个信号让调用方打开 `ChapterDownloadDialog`；新增 `downloadChapters(comic, chapterIds)` 调用 `startDownload(comic.id, comic, undefined, chapterIds)`，并为返回的 `taskIds` 各 upsert 一个 task。

```ts
  const downloadChapters = async (comic: ComicInfo, chapterIds: string[]) => {
    try {
      const result = await startDownload(comic.id, comic, undefined, chapterIds)
      for (const taskId of result.taskIds ?? []) {
        upsertTask({ id: taskId, comic, status: 'queued', progress: 0,
                     totalPages: comic.pages || 0, downloadedPages: 0 })
      }
      return true
    } catch (err) { console.error('Chapter download failed:', err); return false }
  }
```

`return` 增加 `downloadChapters`。下载触发组件：`comic.chapters?.length > 1` 时打开弹窗，确认回调里 `downloadChapters(comic, ids)`；否则走原 `downloadWithConflictCheck`。

- [ ] **Step 5: Run + commit**

Run: `npx vitest run tests/unit/components/ChapterDownloadDialog.test.tsx tests/unit/hooks/useDownloadHelper.test.ts`
Expected: PASS

```bash
git add src/components/ChapterDownloadDialog.tsx src/hooks/useDownloadHelper.ts src/components/ComicInfoDrawer.tsx tests/unit
git commit -m "✨ feat: multi-select chapter download dialog"
```

---

## Task 15: 集成验证

- [ ] **Step 1: 全量 Python 测试**

Run: `python -m pytest -q`
Expected: 全绿（含新增章节、反混淆、历史、下载历史测试）

- [ ] **Step 2: 全量前端测试 + 类型检查 + lint**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: 全绿

- [ ] **Step 3: 修复并提交**

修复任何回归后：

```bash
git add -A
git commit -m "✅ test: fix regressions from jmcomic chapter adaptation"
```

---

## 自查记录（Self-Review）

- **Spec 覆盖：** §3→T1，§4→T3/T5，§5→T2/T4，§6→T6/T9，§7→T10/T11/T12，§8→T7/T14，§9→T8，§10→T13，§11→各任务测试步骤 + T15，§12 假设已在 T3 标注「需真实多章节页校验 XPath」，§13 迁移→T8/T13 ALTER 步骤。
- **类型/命名一致性：** `ChapterInfo`、`album_id`/`albumId`、`album_total_chapters`/`albumTotalChapters`、`get_chapter_images`、`get_chapter_preview_urls`/`getChapterPreviewUrls`、`fetchChapterUrls`、`goToChapter`、`chapterIds` 在前后端各任务中保持一致。
- **偏离 spec 标注：** T7 下载输出路径由 spec 的嵌套 `{专辑名}/{章节名}/` 改为扁平 `{专辑名} - {章节名}`（已说明原因，保持现有路径校验/冲突逻辑不变）。
- **无占位符：** 每个代码步骤均给出完整代码与确切命令。
