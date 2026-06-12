# 多章节漫画专辑文件夹布局 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 多章节漫画下载时，将同一专辑的所有章节集中到一个专辑文件夹下，每章以子文件夹区分；cbz 模式齐套后整体打包为单个专辑 cbz。

**Architecture:** 新增 `AlbumStagingCoordinator` 组件管理专辑级别的文件夹组织、齐套判定和打包。`ComicDownloadManager` 在章成功落盘后调用 coordinator。`CBZBuilder` 新增专辑级方法。IPC 层新增 `force_pack_album` / `get_album_progress` 两个 handler。前端按 `(sourceSite, albumId)` 视图聚合。

**Tech Stack:** Python (dataclasses, zipfile, shutil), TypeScript/React (Zustand, Electron IPC)

**Spec:** `docs/superpowers/specs/2026-06-12-album-folder-layout-design.md`

---

## 文件结构总览

| 操作 | 文件 | 职责 |
|------|------|------|
| Modify | `models.py` | 新增 `album_title` 字段 + `is_album_chapter` 属性 |
| Modify | `cbz_builder.py` | 新增 3 个专辑方法 |
| Create | `album_coordinator.py` | 专辑 staging 状态机（核心新逻辑） |
| Modify | `download_manager.py` | `_handle_album_chapter_success` 分支 + coordinator 注入 |
| Modify | `python/ipc/download_mixin.py` | `_download_chapters` 填 `album_title`、新增 2 个 handler |
| Modify | `download_history.py` | 新增 `update_output_path_by_album` 批量更新 |
| Modify | `shared/types.ts` | ComicInfo 加 `albumTitle`、新增 IPC 类型 |
| Modify | `electron/main.ts` | 新增 2 个 IPC channel handler |
| Modify | `electron/preload.ts` | 新增 2 个 API 方法 |
| Modify | `src/hooks/useIpc.ts` | 新增 2 个 hook |
| Modify | `src/pages/DownloadPage.tsx` | 专辑卡聚合 + 强制打包按钮 |
| Create | `tests/test_album_coordinator.py` | coordinator 单元测试 |
| Modify | `tests/test_cbz_builder.py` | 专辑 cbz 打包测试 |
| Modify | `tests/test_ipc_download_chapters.py` | album_title / albumKey 测试 |
| Modify | `tests/test_download_manager.py` | album chapter success 测试 |

---

## Task 1: 模型 — ComicInfo.album_title + is_album_chapter

**Files:**
- Modify: `models.py:72-73`
- Modify: `tests/test_models.py`

- [ ] **Step 1: 在 ComicInfo 中新增字段和属性**

在 `models.py` 的 `ComicInfo` dataclass 中，`album_total_chapters` 字段之后新增：

```python
    album_total_chapters: int = 1  # 专辑总章数；单本/其他来源为 1
    album_title: str = ""          # 专辑标题（不含 " - 第N話" 后缀）
```

在 `safe_id` 属性之后新增：

```python
    @property
    def is_album_chapter(self) -> bool:
        """是否为多章节专辑中的一章。"""
        return self.album_total_chapters > 1
```

- [ ] **Step 2: 编写测试**

在 `tests/test_models.py` 中追加：

```python
def test_is_album_chapter_property():
    single = ComicInfo(id="1", album_total_chapters=1)
    assert single.is_album_chapter is False

    chapter = ComicInfo(id="2", album_total_chapters=3, album_title="Test Album")
    assert chapter.is_album_chapter is True
    assert chapter.album_title == "Test Album"


def test_is_album_chapter_default():
    comic = ComicInfo(id="3")
    assert comic.is_album_chapter is False
    assert comic.album_title == ""
```

- [ ] **Step 3: 运行测试验证**

Run: `pytest tests/test_models.py -v`
Expected: 全部 PASS（含新增的 2 个用例）

- [ ] **Step 4: Commit**

```bash
git add models.py tests/test_models.py
git commit -m "feat(models): ComicInfo 新增 album_title 字段与 is_album_chapter 属性"
```

---

## Task 2: CBZBuilder — 专辑级方法

**Files:**
- Modify: `cbz_builder.py` (在 `get_output_path_for_format` 方法之前)
- Modify: `tests/test_cbz_builder.py`

- [ ] **Step 1: 编写 get_album_folder_name 测试**

在 `tests/test_cbz_builder.py` 末尾新增：

```python
class TestAlbumCBZ:
    @pytest.fixture
    def album_comic(self):
        return ComicInfo(
            id="100",
            title="Test Album - 第1話",
            author="Author",
            album_id="100",
            album_title="Test Album",
            album_total_chapters=3,
            source_site="jmcomic",
            comic_source="JMCOMIC",
        )

    def test_get_album_folder_name(self, album_comic):
        builder = CBZBuilder()
        name = builder.get_album_folder_name(album_comic)
        assert name == "Author-Test Album"

    def test_get_album_folder_name_sanitizes(self):
        comic = ComicInfo(
            id="1",
            album_title="Bad<>Name",
            author="A/B",
            album_total_chapters=2,
        )
        builder = CBZBuilder()
        name = builder.get_album_folder_name(comic)
        assert "<" not in name
        assert ">" not in name
        assert "/" not in name

    def test_get_album_output_path_folder(self, album_comic, tmp_path):
        builder = CBZBuilder()
        work_dir, final_path = builder.get_album_output_path(
            album_comic, "folder", str(tmp_path)
        )
        assert work_dir == final_path
        assert work_dir.endswith("Author-Test Album")

    def test_get_album_output_path_cbz(self, album_comic, tmp_path):
        builder = CBZBuilder()
        work_dir, final_path = builder.get_album_output_path(
            album_comic, "cbz", str(tmp_path)
        )
        assert work_dir.endswith("Author-Test Album")
        assert final_path.endswith("Author-Test Album.cbz")
        assert final_path == work_dir + ".cbz"

    def test_build_album_cbz_arcnames(self, tmp_path):
        comic = ComicInfo(
            id="100",
            title="Album - 第1話",
            author="Auth",
            album_id="100",
            album_title="Album",
            album_total_chapters=2,
            source_site="jmcomic",
            comic_source="JMCOMIC",
            pages=2,
        )
        # 构造专辑工作目录
        album_dir = tmp_path / "Auth-Album"
        album_dir.mkdir()
        ch1 = album_dir / "第1話"
        ch1.mkdir()
        (ch1 / "001.jpg").write_bytes(b"\xff\xd8\xff\xd9")
        (ch1 / "002.jpg").write_bytes(b"\xff\xd8\xff\xd9")
        ch2 = album_dir / "第2話"
        ch2.mkdir()
        (ch2 / "001.jpg").write_bytes(b"\xff\xd8\xff\xd9")

        builder = CBZBuilder()
        output = tmp_path / "album.cbz"
        result = builder.build_album_cbz(str(album_dir), comic, str(output), download_dir=str(tmp_path))

        assert Path(result).exists()
        with zipfile.ZipFile(result) as zf:
            names = zf.namelist()
            assert "ComicInfo.xml" in names
            assert "第1話/001.jpg" in names
            assert "第1話/002.jpg" in names
            assert "第2話/001.jpg" in names

    def test_build_album_cbz_comic_info_xml(self, tmp_path):
        comic = ComicInfo(
            id="100",
            title="Album - 第1話",
            author="Auth",
            album_id="100",
            album_title="My Album",
            album_total_chapters=2,
            source_site="jmcomic",
            comic_source="JMCOMIC",
            tags=["tag1"],
            category="cat",
        )
        album_dir = tmp_path / "Auth-Album"
        album_dir.mkdir()
        ch1 = album_dir / "Ch1"
        ch1.mkdir()
        (ch1 / "001.jpg").write_bytes(b"\xff\xd8\xff\xd9")

        builder = CBZBuilder()
        output = tmp_path / "album.cbz"
        builder.build_album_cbz(str(album_dir), comic, str(output), download_dir=str(tmp_path))

        with zipfile.ZipFile(str(output)) as zf:
            xml = zf.read("ComicInfo.xml").decode()
            assert "<Title>My Album</Title>" in xml
            assert "<Series>My Album</Series>" in xml
            assert "<Writer>Auth</Writer>" in xml
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pytest tests/test_cbz_builder.py::TestAlbumCBZ -v`
Expected: FAIL（方法不存在）

- [ ] **Step 3: 实现三个方法**

在 `cbz_builder.py` 的 `get_output_path_for_format` 方法**之前**插入：

```python
    def get_album_folder_name(self, comic: ComicInfo) -> str:
        """返回 {author}-{album_title}（已清理非法字符）。"""
        author = comic.safe_author
        album_title = sanitize_filename(comic.album_title) if comic.album_title else comic.safe_title
        folder_name = f"{author}-{album_title}"
        folder_name = sanitize_path_chars(folder_name)
        folder_name = folder_name.strip(". ")
        if not folder_name:
            folder_name = f"album_{comic.safe_id}"
        return folder_name

    def get_album_output_path(
        self,
        comic: ComicInfo,
        output_format: str,
        download_dir: str | None = None,
    ) -> tuple[str, str]:
        """返回 (专辑工作目录路径, 专辑最终路径)。

        - folder: 两者相同
        - cbz: (download_dir/{folder}, download_dir/{folder}.cbz)
        """
        download_dir = self._get_download_dir(download_dir)
        folder_name = self.get_album_folder_name(comic)
        work_dir = os.path.join(download_dir, folder_name)
        if output_format == "cbz":
            final_path = work_dir + ".cbz"
        else:
            final_path = work_dir
        return work_dir, final_path

    def build_album_cbz(
        self,
        album_dir: str,
        comic: ComicInfo,
        output_path: str,
        overwrite: bool = False,
        download_dir: str | None = None,
    ) -> str:
        """将整个专辑文件夹（含若干章节子文件夹）打包为单个 cbz。

        - 写入根目录 ComicInfo.xml（合并的专辑级元数据）
        - arcname 形如 `第1話/00001.jpg`，按章节子文件夹名 + 文件名排序
        - 临时文件 + os.replace 原子提交
        """
        if download_dir is not None:
            self._validate_path_in_dir(output_path, download_dir)

        if not overwrite and os.path.exists(output_path):
            raise FileExistsError(f"Output already exists: {output_path}")

        output_dir_path = os.path.dirname(output_path)
        if output_dir_path:
            os.makedirs(output_dir_path, exist_ok=True)

        # 收集章节子文件夹（排除 temp_* 和 .stage* 隐藏目录）
        chapter_dirs = sorted(
            d for d in os.listdir(album_dir)
            if os.path.isdir(os.path.join(album_dir, d))
            and not d.startswith("temp_")
            and not d.startswith(".")
        )
        if not chapter_dirs:
            raise ValueError(f"No chapter folders found in {album_dir}")

        logger.info("Building album CBZ: %s (%d chapters)", output_path, len(chapter_dirs))

        basename = os.path.basename(output_path)
        fd, tmp_path = tempfile.mkstemp(
            dir=output_dir_path, prefix=f".{basename}.", suffix=".tmp"
        )
        os.close(fd)
        try:
            with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as zf:
                # 写入专辑级 ComicInfo.xml
                album_comic = ComicInfo(
                    id=comic.album_id or comic.id,
                    title=comic.album_title or comic.title,
                    author=comic.author,
                    pages=0,
                    category=comic.category,
                    tags=comic.tags,
                    parodies=comic.parodies,
                    characters=comic.characters,
                    publish_date=comic.publish_date,
                    source_site=comic.source_site,
                    comic_source=comic.comic_source,
                )
                xml_content = self.generate_comic_info_xml(album_comic)
                zf.writestr("ComicInfo.xml", xml_content)

                # 写入各章节图片
                page_counter = 0
                for chap_name in chapter_dirs:
                    chap_path = os.path.join(album_dir, chap_name)
                    image_files = self._collect_image_files(chap_path)
                    for img_path in image_files:
                        page_counter += 1
                        ext = os.path.splitext(img_path)[1]
                        arcname = f"{chap_name}/{PAGE_FILENAME_FORMAT.format(page=page_counter, ext=ext)}"
                        zf.write(img_path, arcname)

            os.replace(tmp_path, output_path)
        except Exception:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
            raise

        logger.info("Album CBZ created: %s (%d pages)", output_path, page_counter)
        return output_path
```

需要在文件顶部 `from image_formats import ...` 旁确保 `PAGE_FILENAME_FORMAT` 被导入（已存在，无需改）。

- [ ] **Step 4: 运行测试验证通过**

Run: `pytest tests/test_cbz_builder.py -v`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add cbz_builder.py tests/test_cbz_builder.py
git commit -m "feat(cbz_builder): 新增专辑级方法 get_album_folder_name / get_album_output_path / build_album_cbz"
```

---

## Task 3: DownloadHistory — 批量更新专辑路径

**Files:**
- Modify: `download_history.py`
- Modify: `tests/test_download_history.py`

- [ ] **Step 1: 编写测试**

在 `tests/test_download_history.py` 中追加：

```python
def test_update_output_path_by_album(tmp_path):
    from download_history import DownloadHistoryDB
    from models import ComicInfo

    db = DownloadHistoryDB(str(tmp_path / "test.db"))

    # 录入 3 条同专辑记录
    for i in range(1, 4):
        comic = ComicInfo(
            id=f"chap{i}",
            title=f"Album - Ch{i}",
            source_site="jmcomic",
            comic_source="JMCOMIC",
            album_id="album1",
            album_total_chapters=3,
        )
        db.record_download(comic, f"/tmp/ch{i}/", "folder")

    # 批量更新为 cbz 路径
    count = db.update_output_path_by_album(
        source_site="jmcomic",
        comic_source="JMCOMIC",
        album_id="album1",
        new_path="/downloads/Album.cbz",
    )
    assert count == 3

    # 验证每条记录都已更新
    records = db.get_all_records()
    for rec in records:
        assert rec["output_path"] == "/downloads/Album.cbz"

    db.close()


def test_update_output_path_by_album_no_match(tmp_path):
    from download_history import DownloadHistoryDB

    db = DownloadHistoryDB(str(tmp_path / "test.db"))
    count = db.update_output_path_by_album(
        source_site="jmcomic",
        comic_source="JMCOMIC",
        album_id="nonexistent",
        new_path="/x.cbz",
    )
    assert count == 0
    db.close()
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pytest tests/test_download_history.py -v -k update_output_path_by_album`
Expected: FAIL（方法不存在）

- [ ] **Step 3: 实现方法**

在 `download_history.py` 的 `update_output_path` 方法之后添加：

```python
    def update_output_path_by_album(
        self,
        source_site: str,
        comic_source: str,
        album_id: str,
        new_path: str,
    ) -> int:
        """将指定专辑下所有章节记录的 output_path 批量更新为 new_path。

        Returns:
            受影响的行数。
        """
        with self._lock:
            cursor = self._conn.execute(
                "UPDATE download_history SET output_path = ? "
                "WHERE source_site = ? AND comic_source = ? AND album_id = ?",
                (new_path, source_site, comic_source, album_id),
            )
            self._conn.commit()
            return cursor.rowcount
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pytest tests/test_download_history.py -v -k update_output_path_by_album`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add download_history.py tests/test_download_history.py
git commit -m "feat(download_history): 新增 update_output_path_by_album 批量更新专辑路径"
```

---

## Task 4: AlbumStagingCoordinator — 核心新组件

**Files:**
- Create: `album_coordinator.py`
- Create: `tests/test_album_coordinator.py`

- [ ] **Step 1: 编写完整测试**

```python
"""tests/test_album_coordinator.py"""
import os
import zipfile
from pathlib import Path

import pytest

from album_coordinator import AlbumKey, AlbumProgress, AlbumStagingCoordinator, PackResult
from models import ComicInfo, DownloadStatus, DownloadTask


def _make_task(chap_id: str, album_id: str = "100", total: int = 3, title: str = "Album") -> DownloadTask:
    comic = ComicInfo(
        id=chap_id,
        title=f"{title} - Ch{chap_id}",
        source_site="jmcomic",
        comic_source="JMCOMIC",
        album_id=album_id,
        album_total_chapters=total,
        album_title=title,
        pages=2,
    )
    return DownloadTask(comic=comic, status=DownloadStatus.QUEUED)


class TestAlbumStagingCoordinator:
    def _make_coordinator(self, tmp_path, output_format="cbz"):
        download_dir = str(tmp_path / "downloads")
        os.makedirs(download_dir)

        events = []

        def on_event(key, event, **kwargs):
            events.append((key, event, kwargs))

        coord = AlbumStagingCoordinator(
            download_dir_provider=lambda: download_dir,
            output_format_provider=lambda: output_format,
            history_db=None,
            on_album_event=on_event,
        )
        return coord, events, download_dir

    def test_register_and_get_progress(self, tmp_path):
        coord, events, dd = self._make_coordinator(tmp_path)
        key: AlbumKey = ("jmcomic", "100")
        coord.register_album_tasks(key, ["t1", "t2", "t3"], album_total_chapters=3)

        prog = coord.get_progress(key)
        assert prog.total_chapters == 3
        assert prog.chapters_in_queue == 3

    def test_get_progress_unknown_album(self, tmp_path):
        coord, _, _ = self._make_coordinator(tmp_path)
        prog = coord.get_progress(("jmcomic", "999"))
        assert prog.total_chapters == 0

    def test_on_chapter_complete_notifies_event(self, tmp_path):
        coord, events, dd = self._make_coordinator(tmp_path)
        key: AlbumKey = ("jmcomic", "100")
        coord.register_album_tasks(key, ["t1"], album_total_chapters=1)

        # 创建专辑文件夹 + 章节子文件夹
        album_dir = os.path.join(dd, "Author-Album")
        ch_dir = os.path.join(album_dir, "Ch1")
        os.makedirs(ch_dir)
        Path(ch_dir, "001.jpg").write_bytes(b"\xff\xd8\xff\xd9")

        task = _make_task("100", total=1, title="Album")
        coord.on_chapter_complete(task, album_dir)

        assert len(events) >= 1
        assert events[0][1] == "chapter_done"

    def test_force_pack_no_chapters(self, tmp_path):
        coord, events, dd = self._make_coordinator(tmp_path)
        result = coord.force_pack_album(("jmcomic", "100"))
        assert result.status == "no_chapters"

    def test_force_pack_conflict_when_exists(self, tmp_path):
        coord, events, dd = self._make_coordinator(tmp_path)
        # 创建一个已存在的 .cbz
        existing = os.path.join(dd, "Author-Album.cbz")
        Path(existing).write_bytes(b"fake")

        # 创建专辑工作目录 + 章节
        album_dir = os.path.join(dd, "Author-Album")
        ch1 = os.path.join(album_dir, "Ch1")
        os.makedirs(ch1)
        Path(ch1, "001.jpg").write_bytes(b"\xff\xd8\xff\xd9")

        key: AlbumKey = ("jmcomic", "100")
        result = coord.force_pack_album(key, overwrite=False)
        assert result.status == "conflict"
        assert result.existing_path == existing

    def test_force_pack_packs_cbz(self, tmp_path):
        coord, events, dd = self._make_coordinator(tmp_path)
        album_dir = os.path.join(dd, "Auth-Album")
        ch1 = os.path.join(album_dir, "Ch1")
        os.makedirs(ch1)
        Path(ch1, "001.jpg").write_bytes(b"\xff\xd8\xff\xd9")

        comic = ComicInfo(
            id="100", title="Album - Ch1", source_site="jmcomic",
            comic_source="JMCOMIC", album_id="100", album_title="Album",
            album_total_chapters=1, author="Auth", pages=1,
        )

        key: AlbumKey = ("jmcomic", "100")
        coord.register_album_tasks(key, ["t1"], album_total_chapters=1)
        result = coord.force_pack_album(key, overwrite=False, comic=comic)

        assert result.status == "packed"
        assert result.output_path.endswith(".cbz")
        assert os.path.exists(result.output_path)
        assert not os.path.exists(album_dir)

    def test_force_pack_folder_no_packing(self, tmp_path):
        coord, events, dd = self._make_coordinator(tmp_path, output_format="folder")
        album_dir = os.path.join(dd, "Auth-Album")
        ch1 = os.path.join(album_dir, "Ch1")
        os.makedirs(ch1)
        Path(ch1, "001.jpg").write_bytes(b"\xff\xd8\xff\xd9")

        comic = ComicInfo(
            id="100", title="Album - Ch1", source_site="jmcomic",
            comic_source="JMCOMIC", album_id="100", album_title="Album",
            album_total_chapters=1, author="Auth", pages=1,
        )

        key: AlbumKey = ("jmcomic", "100")
        coord.register_album_tasks(key, ["t1"], album_total_chapters=1)
        result = coord.force_pack_album(key, overwrite=False, comic=comic)

        assert result.status == "packed"
        assert result.output_path == album_dir
        assert os.path.exists(album_dir)
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pytest tests/test_album_coordinator.py -v`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 AlbumStagingCoordinator**

```python
"""专辑下载 staging 协调器 — 管理多章漫画的文件夹组织与打包。"""

from __future__ import annotations

import logging
import os
import shutil
from dataclasses import dataclass, field

from models import ComicInfo, DownloadTask

logger = logging.getLogger(__name__)

AlbumKey = tuple[str, str]  # (source_site, album_id)


@dataclass
class AlbumState:
    task_ids: set[str] = field(default_factory=set)
    total_chapters: int = 1
    comic: ComicInfo | None = None  # 任一章的 comic，用于提取专辑元数据


@dataclass
class PackResult:
    status: str  # "packed" | "no_chapters" | "conflict" | "error"
    output_path: str | None = None
    packed_chapters: int = 0
    missing_chapters: int = 0
    existing_path: str | None = None
    error_message: str | None = None


@dataclass
class AlbumProgress:
    album_id: str = ""
    album_title: str = ""
    album_folder_path: str = ""
    packed_path: str | None = None
    total_chapters: int = 0
    chapters_on_disk: int = 0
    chapters_in_queue: int = 0
    is_complete: bool = False


class AlbumStagingCoordinator:
    """以 (source_site, album_id) 为单位的专辑下载状态机。"""

    def __init__(
        self,
        download_dir_provider,
        output_format_provider,
        history_db=None,
        on_album_event=None,
    ):
        self._get_download_dir = download_dir_provider
        self._get_output_format = output_format_provider
        self._history_db = history_db
        self._on_album_event = on_album_event
        self._tracked: dict[AlbumKey, AlbumState] = {}

    def register_album_tasks(
        self,
        album_key: AlbumKey,
        task_ids: list[str],
        album_total_chapters: int,
    ) -> None:
        """_download_chapters 调用：注册本次任务集。"""
        state = self._tracked.get(album_key)
        if state is None:
            state = AlbumState(total_chapters=album_total_chapters)
            self._tracked[album_key] = state
        state.task_ids.update(task_ids)
        state.total_chapters = album_total_chapters

    def set_album_comic(self, album_key: AlbumKey, comic: ComicInfo) -> None:
        """记录专辑的 ComicInfo（用于打包时提取元数据）。"""
        state = self._tracked.get(album_key)
        if state:
            state.comic = comic

    def on_chapter_complete(
        self, task: DownloadTask, album_work_dir: str
    ) -> None:
        """ComicDownloadManager 在章节成功落盘后调用。"""
        album_key: AlbumKey = (
            task.comic.source_site,
            task.comic.album_id or task.comic.id,
        )
        state = self._tracked.get(album_key)
        if state:
            if state.comic is None:
                state.comic = task.comic
            self._emit_event(album_key, "chapter_done")
            self._check_and_pack(album_key, album_work_dir)

    def force_pack_album(
        self,
        album_key: AlbumKey,
        *,
        overwrite: bool = False,
        comic: ComicInfo | None = None,
    ) -> PackResult:
        """UI「强制打包」入口。"""
        state = self._tracked.get(album_key)
        effective_comic = comic or (state.comic if state else None)

        if effective_comic is None:
            return PackResult(status="no_chapters")

        download_dir = self._get_download_dir()
        from cbz_builder import CBZBuilder
        builder = CBZBuilder()
        work_dir, final_path = builder.get_album_output_path(
            effective_comic, self._get_output_format(), download_dir
        )

        if not os.path.isdir(work_dir):
            return PackResult(status="no_chapters")

        output_format = self._get_output_format()

        if output_format == "cbz":
            if os.path.exists(final_path) and not overwrite:
                return PackResult(
                    status="conflict",
                    existing_path=final_path,
                )

            chapter_dirs = self._scan_chapter_dirs(work_dir)
            if not chapter_dirs:
                return PackResult(status="no_chapters")

            self._emit_event(album_key, "force_pack_started")
            try:
                builder.build_album_cbz(
                    work_dir, effective_comic, final_path,
                    overwrite=overwrite, download_dir=download_dir,
                )
                shutil.rmtree(work_dir)
                self._update_history(album_key, final_path)
                self._emit_event(
                    album_key, "packed",
                    output_path=final_path,
                    chapters_on_disk=len(chapter_dirs),
                )
                return PackResult(
                    status="packed",
                    output_path=final_path,
                    packed_chapters=len(chapter_dirs),
                )
            except Exception as e:
                logger.error("Force pack failed for %s: %s", album_key, e)
                self._emit_event(album_key, "force_pack_done", error_message=str(e))
                return PackResult(status="error", error_message=str(e))
        else:
            # folder 模式：不打包，直接返回当前状态
            chapter_dirs = self._scan_chapter_dirs(work_dir)
            self._emit_event(
                album_key, "packed",
                output_path=work_dir,
                chapters_on_disk=len(chapter_dirs),
            )
            return PackResult(
                status="packed",
                output_path=work_dir,
                packed_chapters=len(chapter_dirs),
            )

    def get_progress(self, album_key: AlbumKey) -> AlbumProgress:
        """供 IPC handle_get_album_progress 调用。"""
        state = self._tracked.get(album_key)
        if state is None:
            return AlbumProgress()

        download_dir = self._get_download_dir()
        comic = state.comic
        if comic is None:
            return AlbumProgress(
                album_id=album_key[1],
                total_chapters=state.total_chapters,
                chapters_in_queue=len(state.task_ids),
            )

        from cbz_builder import CBZBuilder
        builder = CBZBuilder()
        work_dir, final_path = builder.get_album_output_path(
            comic, self._get_output_format(), download_dir
        )

        chapters_on_disk = 0
        if os.path.isdir(work_dir):
            chapters_on_disk = len(self._scan_chapter_dirs(work_dir))

        packed_path = final_path if os.path.exists(final_path) else None

        return AlbumProgress(
            album_id=album_key[1],
            album_title=comic.album_title,
            album_folder_path=work_dir,
            packed_path=packed_path,
            total_chapters=state.total_chapters,
            chapters_on_disk=chapters_on_disk,
            chapters_in_queue=len(state.task_ids),
            is_complete=packed_path is not None,
        )

    def _check_and_pack(self, album_key: AlbumKey, album_work_dir: str) -> None:
        """判定是否齐套并自动打包（仅 cbz 模式）。"""
        state = self._tracked.get(album_key)
        if state is None or state.comic is None:
            return

        output_format = self._get_output_format()
        if output_format != "cbz":
            return

        chapter_dirs = self._scan_chapter_dirs(album_work_dir)
        if len(chapter_dirs) < state.total_chapters:
            return

        # 齐套：自动打包
        self.force_pack_album(album_key, overwrite=False, comic=state.comic)

    def _scan_chapter_dirs(self, album_dir: str) -> list[str]:
        """扫描专辑工作目录下的章节子文件夹（排除 temp_* 和隐藏目录）。"""
        if not os.path.isdir(album_dir):
            return []
        return sorted(
            d for d in os.listdir(album_dir)
            if os.path.isdir(os.path.join(album_dir, d))
            and not d.startswith("temp_")
            and not d.startswith(".")
        )

    def _update_history(self, album_key: AlbumKey, new_path: str) -> None:
        """更新 download_history 中该专辑所有记录的 output_path。"""
        if self._history_db is None:
            return
        state = self._tracked.get(album_key)
        if state is None or state.comic is None:
            return
        try:
            count = self._history_db.update_output_path_by_album(
                source_site=album_key[0],
                comic_source=state.comic.comic_source,
                album_id=album_key[1],
                new_path=new_path,
            )
            logger.info("Updated %d history records for album %s", count, album_key)
        except Exception:
            logger.warning("Failed to update history for album %s", album_key, exc_info=True)

    def _emit_event(self, album_key: AlbumKey, event: str, **kwargs) -> None:
        if self._on_album_event:
            try:
                self._on_album_event(album_key, event, **kwargs)
            except Exception:
                logger.warning("Album event callback failed", exc_info=True)
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pytest tests/test_album_coordinator.py -v`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add album_coordinator.py tests/test_album_coordinator.py
git commit -m "feat: 新增 AlbumStagingCoordinator 专辑下载状态机"
```

---

## Task 5: ComicDownloadManager — 专辑章成功分支

**Files:**
- Modify: `download_manager.py`
- Modify: `tests/test_download_manager.py`

- [ ] **Step 1: 编写测试**

在 `tests/test_download_manager.py` 末尾追加：

```python
def test_handle_album_chapter_success_moves_to_album_folder(tmp_path):
    """专辑章下载成功后，temp 目录被移动到 专辑文件夹/章节名/。"""
    from unittest.mock import MagicMock

    downloader = MagicMock()
    downloader.download_comic_resume.return_value = DownloadResult(
        success=True, completed_pages=[1], failed_pages=[],
        temp_dir=str(tmp_path / "temp_jmcomic_100"),
    )
    downloader.cleanup_temp_dir = MagicMock()

    cbz_builder = MagicMock()
    manager = ComicDownloadManager(
        downloader=downloader,
        cbz_builder=cbz_builder,
        output_dir=str(tmp_path / "output"),
        output_format="folder",
    )

    # 注入 coordinator
    from album_coordinator import AlbumStagingCoordinator
    coordinator = AlbumStagingCoordinator(
        download_dir_provider=lambda: str(tmp_path / "output"),
        output_format_provider=lambda: "folder",
    )
    manager.set_album_coordinator(coordinator)

    comic = ComicInfo(
        id="100", title="Album - Ch1", source_site="jmcomic",
        comic_source="JMCOMIC", album_id="100", album_title="Album",
        album_total_chapters=3, author="Auth", pages=2,
    )
    task = DownloadTask(comic=comic, status=DownloadStatus.DOWNLOADING)
    manager.tasks[task.task_id] = task

    # 创建 temp 目录
    temp_dir = tmp_path / "temp_jmcomic_100"
    temp_dir.mkdir()
    (temp_dir / "001.jpg").write_bytes(b"\xff\xd8\xff\xd9")
    (temp_dir / "002.jpg").write_bytes(b"\xff\xd8\xff\xd9")

    result = DownloadResult(
        success=True, completed_pages=[1, 2], failed_pages=[],
        temp_dir=str(temp_dir),
    )

    manager._handle_album_chapter_success(task, result)

    # 章节目录应该在专辑文件夹下
    album_dir = tmp_path / "output" / "Auth-Album"
    chapter_dir = album_dir / "Ch1"
    assert chapter_dir.exists()
    assert (chapter_dir / "001.jpg").exists()
    assert not temp_dir.exists()
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pytest tests/test_download_manager.py -v -k test_handle_album_chapter_success`
Expected: FAIL（方法不存在）

- [ ] **Step 3: 实现方法**

在 `download_manager.py` 的 `ComicDownloadManager` 类中，`_handle_download_success` 方法之后新增：

```python
    def set_album_coordinator(self, coordinator):
        """注入专辑 staging 协调器。"""
        self._album_coordinator = coordinator

    def _get_chapter_display_name(self, comic) -> str:
        """从 ComicInfo.title 提取章节显示名（去掉专辑名前缀）。"""
        album_title = getattr(comic, "album_title", "")
        if album_title and comic.title.startswith(album_title):
            suffix = comic.title[len(album_title):]
            if suffix.startswith(" - "):
                return suffix[3:].strip()
            if suffix.startswith("-"):
                return suffix[1:].strip()
        return comic.safe_title

    def _handle_album_chapter_success(self, task: DownloadTask, result: DownloadResult) -> None:
        """处理专辑章下载成功：移动 temp 到 专辑文件夹/章节名/。"""
        comic = task.comic
        album_dir_name = self.cbz_builder.get_album_folder_name(comic)
        album_work_dir = os.path.join(self.output_dir, album_dir_name)
        chapter_name = self._get_chapter_display_name(comic)
        chapter_final_path = os.path.join(album_work_dir, chapter_name)

        # 如果已有同名章节目录（重试场景），先清理
        if os.path.exists(chapter_final_path):
            shutil.rmtree(chapter_final_path)

        os.makedirs(album_work_dir, exist_ok=True)
        shutil.move(result.temp_dir, chapter_final_path)

        logger.info(
            "Album chapter saved: %s -> %s",
            result.temp_dir, chapter_final_path,
        )

        # 写入历史（章级，output_path 暂为章节子文件夹路径）
        output_path_for_history = chapter_final_path
        if self.on_download_success:
            try:
                self.on_download_success(comic, output_path_for_history, "folder")
            except Exception:
                logger.warning("on_download_success callback failed", exc_info=True)

        with self._lock:
            task.temp_dir = None
            task.status = DownloadStatus.COMPLETED
            task.current_downloading_page = 0
        self._notify_task_update(task)

        # 通知 coordinator
        coordinator = getattr(self, "_album_coordinator", None)
        if coordinator:
            coordinator.on_chapter_complete(task, album_work_dir)
```

同时修改 `_handle_download_success` 方法，在开头插入分支：

在 `_handle_download_success` 方法的 `with self._lock: task.temp_dir = result.temp_dir` 之后，`if self._check_cancel_before_packaging(task, result)` 之前，插入：

```python
        if task.comic.is_album_chapter:
            if self._check_cancel_before_packaging(task, result):
                return
            self._handle_album_chapter_success(task, result)
            return
```

同时修改 `_execute_download` 方法，在 `is_album_chapter` 时将 `output_dir` 替换为专辑工作目录：

在 `_execute_download` 的 `result: DownloadResult = self.downloader.download_comic_resume(` 之前，增加：

```python
        # 多章专辑：temp 目录放在专辑工作目录内
        effective_output_dir = self.output_dir
        if task.comic.is_album_chapter:
            album_dir_name = self.cbz_builder.get_album_folder_name(task.comic)
            effective_output_dir = os.path.join(self.output_dir, album_dir_name)
            os.makedirs(effective_output_dir, exist_ok=True)
```

并将 `download_comic_resume` 的 `self.output_dir` 改为 `effective_output_dir`。

- [ ] **Step 4: 运行测试验证通过**

Run: `pytest tests/test_download_manager.py -v`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add download_manager.py tests/test_download_manager.py
git commit -m "feat(download_manager): 专辑章成功后移动到专辑文件夹，注入 AlbumStagingCoordinator"
```

---

## Task 6: IPC 层 — download_mixin 修改与新增 handler

**Files:**
- Modify: `python/ipc/download_mixin.py`
- Modify: `tests/test_ipc_download_chapters.py`

- [ ] **Step 1: 修改 _download_chapters 填入 album_title**

在 `python/ipc/download_mixin.py` 的 `_download_chapters` 方法中，找到：

```python
        album_title = comic_data.get("title", "Unknown")
```

在其后新增一行：

```python
        album_title = comic_data.get("title", "Unknown")
        raw_album_title = album_title  # 保留原始专辑名用于 album_title 字段
```

然后在每个 `ComicInfo(...)` 构造中（bika 和 jmcomic 两个分支都改），添加 `album_title=raw_album_title`：

bika 分支：
```python
                    comic = ComicInfo(
                        id=chap_id,
                        title=f"{album_title} - {chap_name}",
                        source_site="bika",
                        comic_source="BIKA",
                        media_id=chap_id,
                        image_urls=image_urls,
                        pages=len(image_urls),
                        album_id=album_id,
                        album_total_chapters=total,
                        album_title=raw_album_title,
                    )
```

jmcomic 分支：
```python
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
                        album_title=raw_album_title,
                    )
```

在 `_download_chapters` 返回之前，注册到 coordinator 并追加 albumKey：

```python
        # 注册到专辑 coordinator
        album_key = (source_site, album_id)
        coordinator = getattr(self, "_album_coordinator", None)
        if coordinator and task_ids:
            coordinator.register_album_tasks(album_key, task_ids, total)

        status = "queued" if task_ids else "error"
        result = {"taskIds": task_ids, "failedChapters": failed, "status": status}
        if task_ids:
            result["albumKey"] = {"sourceSite": source_site, "albumId": album_id}
        return result
```

（替换原有的最后两行 `status = ...` 和 `return {...}`）

- [ ] **Step 2: 新增两个 handler 方法**

在 `download_mixin.py` 的 `handle_get_download_detail` 方法之后追加：

```python
    def handle_force_pack_album(
        self, source_site: str, album_id: str, overwrite: bool = False
    ) -> dict:
        """强制打包专辑。"""
        coordinator = getattr(self, "_album_coordinator", None)
        if coordinator is None:
            return {"status": "error", "errorMessage": "Album coordinator not available"}
        album_key = (source_site, album_id)
        result = coordinator.force_pack_album(album_key, overwrite=overwrite)
        return {
            "status": result.status,
            "outputPath": result.output_path,
            "packedChapters": result.packed_chapters,
            "missingChapters": result.missing_chapters,
            "existingPath": result.existing_path,
            "errorMessage": result.error_message,
        }

    def handle_get_album_progress(
        self, source_site: str, album_id: str
    ) -> dict:
        """查询专辑下载进度。"""
        coordinator = getattr(self, "_album_coordinator", None)
        if coordinator is None:
            return {
                "albumId": album_id, "albumTitle": "", "albumFolderPath": "",
                "packedPath": None, "totalChapters": 0, "chaptersOnDisk": 0,
                "chaptersInQueue": 0, "isComplete": False,
            }
        album_key = (source_site, album_id)
        prog = coordinator.get_progress(album_key)
        return {
            "albumId": prog.album_id,
            "albumTitle": prog.album_title,
            "albumFolderPath": prog.album_folder_path,
            "packedPath": prog.packed_path,
            "totalChapters": prog.total_chapters,
            "chaptersOnDisk": prog.chapters_on_disk,
            "chaptersInQueue": prog.chapters_in_queue,
            "isComplete": prog.is_complete,
        }
```

- [ ] **Step 3: 修改 handle_check_download_conflict**

在 `handle_check_download_conflict` 方法中，找到：

```python
    def handle_check_download_conflict(self, comic_data: dict) -> dict:
        comic = self._build_and_prepare_comic(comic_data or {})
        output_path = self.cbz_builder.get_output_path_for_format(
            comic, self.config.output_format, self.config.download_dir
        )
        return {
            "hasConflict": os.path.exists(output_path),
            "path": output_path,
        }
```

替换为：

```python
    def handle_check_download_conflict(self, comic_data: dict) -> dict:
        comic = self._build_and_prepare_comic(comic_data or {})

        # 多章专辑：检查专辑文件夹内是否有该章子文件夹
        if comic.is_album_chapter:
            album_dir_name = self.cbz_builder.get_album_folder_name(comic)
            album_work_dir = os.path.join(self.config.download_dir, album_dir_name)
            chapter_name = self._get_chapter_display_name(comic)
            chapter_path = os.path.join(album_work_dir, chapter_name)
            has_conflict = os.path.exists(chapter_path)
            return {
                "hasConflict": has_conflict,
                "path": chapter_path,
            }

        output_path = self.cbz_builder.get_output_path_for_format(
            comic, self.config.output_format, self.config.download_dir
        )
        return {
            "hasConflict": os.path.exists(output_path),
            "path": output_path,
        }
```

注意：`_get_chapter_display_name` 方法需要在 `DownloadMixin` 中可用。可以在 mixin 中定义一个私有方法，或者从 `ComicDownloadManager` 复用。最简单的方式是在 mixin 中也定义一个：

```python
    @staticmethod
    def _get_chapter_display_name(comic) -> str:
        """从 ComicInfo.title 提取章节显示名（去掉专辑名前缀）。"""
        album_title = getattr(comic, "album_title", "")
        if album_title and comic.title.startswith(album_title):
            suffix = comic.title[len(album_title):]
            if suffix.startswith(" - "):
                return suffix[3:].strip()
            if suffix.startswith("-"):
                return suffix[1:].strip()
        return comic.safe_title
```

- [ ] **Step 4: 编写并运行测试**

在 `tests/test_ipc_download_chapters.py` 中追加：

```python
def test_download_chapters_sets_album_title(monkeypatch):
    """章节 ComicInfo.album_title 应被正确填入。"""
    server = _create_test_server()
    fake_jm = SimpleNamespace(
        get_chapter_images=lambda cid: (
            [f"https://cdn/media/photos/{cid}/00001.webp"],
            "220980",
        )
    )
    server.parser.parsers = {"jmcomic": fake_jm}

    created = []

    def fake_add_task(comic, overwrite=False):
        created.append(comic)
        return comic.id

    server._download_manager = SimpleNamespace(add_task=fake_add_task, tasks={})

    comic_data = {
        "id": "999001",
        "title": "多章漫画",
        "sourceSite": "jmcomic",
        "source": "JMCOMIC",
        "albumTotalChapters": 2,
        "chapters": [
            {"id": "999001", "name": "第 1 話", "index": 1},
            {"id": "999002", "name": "第 2 話", "index": 2},
        ],
    }
    result = server.handle_download("999001", comic_data, chapter_ids=["999001", "999002"])

    assert created[0].album_title == "多章漫画"
    assert created[1].album_title == "多章漫画"
    assert result.get("albumKey") == {"sourceSite": "jmcomic", "albumId": "999001"}


def test_handle_force_pack_album_no_coordinator():
    """没有 coordinator 时应返回 error。"""
    server = _create_test_server()
    # 不注入 coordinator
    result = server.handle_force_pack_album("jmcomic", "999001")
    assert result["status"] == "error"
```

Run: `pytest tests/test_ipc_download_chapters.py -v`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add python/ipc/download_mixin.py tests/test_ipc_download_chapters.py
git commit -m "feat(ipc): _download_chapters 填入 album_title、新增 force_pack_album / get_album_progress handler"
```

---

## Task 7: IPC Server 初始化 — 注入 coordinator + 注册新 channel

**Files:**
- Modify: `python/ipc_server.py` (或入口文件)
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `shared/types.ts`

- [ ] **Step 1: Python 端初始化 coordinator**

在 `python/ipc_server.py` 的 `IPCServer.__init__` 中，第 104 行 `self._download_manager.on_download_success = self._on_download_success_record` 之后插入：

```python
        # Album staging coordinator for multi-chapter comics
        from album_coordinator import AlbumStagingCoordinator

        self._album_coordinator = AlbumStagingCoordinator(
            download_dir_provider=lambda: self.config.download_dir,
            output_format_provider=lambda: self.config.output_format,
            history_db=self._history_db,
            on_album_event=self._on_album_event,
        )
        self._download_manager.set_album_coordinator(self._album_coordinator)
```

在同一文件的 `IPCServer` 类中新增事件回调方法（放在 `_on_download_update` 附近）：

```python
    def _on_album_event(self, album_key, event, **kwargs):
        """推送 album_progress JSON-RPC 通知到 stdout。"""
        notification = {
            "jsonrpc": "2.0",
            "method": "album_progress",
            "params": {
                "sourceSite": album_key[0],
                "albumId": album_key[1],
                "event": event,
                **kwargs,
            },
        }
        self._write_response(notification)
```

- [ ] **Step 2: shared/types.ts — 新增类型**

在 `shared/types.ts` 的 `IPCMethods` 接口中追加：

```typescript
  force_pack_album: {
    params: { source_site: string; album_id: string; overwrite?: boolean }
    result: {
      status: string
      outputPath?: string
      packedChapters?: number
      missingChapters?: number
      existingPath?: string
      errorMessage?: string
    }
  }
  get_album_progress: {
    params: { source_site: string; album_id: string }
    result: {
      albumId: string
      albumTitle: string
      albumFolderPath: string
      packedPath: string | null
      totalChapters: number
      chaptersOnDisk: number
      chaptersInQueue: number
      isComplete: boolean
    }
  }
```

在 `PYTHON_IPC_CHANNEL_MAP` 中追加：

```typescript
  'python:force-pack-album': 'force_pack_album',
  'python:get-album-progress': 'get_album_progress',
```

在 `IPC_CHANNELS` 中追加：

```typescript
  FORCE_PACK_ALBUM: 'python:force-pack-album',
  GET_ALBUM_PROGRESS: 'python:get-album-progress',
```

在 `PYTHON_NOTIFICATION_METHODS` 中追加：

```typescript
  ALBUM_PROGRESS: 'album_progress',
```

在 `ComicInfo` 接口中追加字段：

```typescript
  albumTitle?: string
```

在 `HcomicAPI` 接口中追加：

```typescript
  forcePackAlbum(sourceSite: string, albumId: string, overwrite?: boolean): Promise<{
    status: string; outputPath?: string; packedChapters?: number;
    missingChapters?: number; existingPath?: string; errorMessage?: string;
  }>
  getAlbumProgress(sourceSite: string, albumId: string): Promise<{
    albumId: string; albumTitle: string; albumFolderPath: string;
    packedPath: string | null; totalChapters: number; chaptersOnDisk: number;
    chaptersInQueue: number; isComplete: boolean;
  }>
  onAlbumProgress(callback: (data: { sourceSite: string; albumId: string; event: string; outputPath?: string; chaptersOnDisk?: number; totalChapters?: number }) => void): () => void
```

- [ ] **Step 3: electron/preload.ts — 新增 API**

在 `preload.ts` 的 `contextBridge.exposeInMainWorld` 对象中追加：

```typescript
  forcePackAlbum: (sourceSite: unknown, albumId: unknown, overwrite?: unknown) => {
    assert(and(string(), length(1, 256)), sourceSite, 'forcePackAlbum sourceSite')
    assert(and(string(), length(1, 256)), albumId, 'forcePackAlbum albumId')
    return ipcRenderer.invoke(IPC_CHANNELS.FORCE_PACK_ALBUM, sourceSite, albumId, overwrite ?? false)
  },
  getAlbumProgress: (sourceSite: unknown, albumId: unknown) => {
    assert(and(string(), length(1, 256)), sourceSite, 'getAlbumProgress sourceSite')
    assert(and(string(), length(1, 256)), albumId, 'getAlbumProgress albumId')
    return ipcRenderer.invoke(IPC_CHANNELS.GET_ALBUM_PROGRESS, sourceSite, albumId)
  },
  onAlbumProgress: (callback: unknown) => {
    assert(function_(), callback, 'onAlbumProgress callback')
    const handler = (_event: unknown, data: unknown) => callback(data)
    ipcRenderer.on(NOTIFICATION_CHANNELS.ALBUM_PROGRESS, handler)
    return () => ipcRenderer.removeListener(NOTIFICATION_CHANNELS.ALBUM_PROGRESS, handler)
  },
```

注意：需要在 preload 顶部导入 `NOTIFICATION_CHANNELS`（如果尚未导入）。

- [ ] **Step 4: electron/main.ts — 注册 IPC handler**

在 `registerDownloadHandlers` 函数中（或其附近）追加：

```typescript
function registerAlbumHandlers(bridge: Bridge) {
  ipcMain.handle(IPC_CHANNELS.FORCE_PACK_ALBUM, async (_, sourceSite: unknown, albumId: unknown, overwrite?: unknown) => {
    assert(and(string(), length(1, 256)), sourceSite, 'forcePackAlbum sourceSite')
    assert(and(string(), length(1, 256)), albumId, 'forcePackAlbum albumId')
    return bridge.call('force_pack_album', {
      source_site: sourceSite,
      album_id: albumId,
      overwrite: overwrite ?? false,
    })
  })

  ipcMain.handle(IPC_CHANNELS.GET_ALBUM_PROGRESS, async (_, sourceSite: unknown, albumId: unknown) => {
    assert(and(string(), length(1, 256)), sourceSite, 'getAlbumProgress sourceSite')
    assert(and(string(), length(1, 256)), albumId, 'getAlbumProgress albumId')
    return bridge.call('get_album_progress', {
      source_site: sourceSite,
      album_id: albumId,
    })
  })
}
```

在 `createWindow` 或初始化函数中调用 `registerAlbumHandlers(bridge)`。

同时在 `validateDownloadProgress` 附近注册 `album_progress` 通知的转发：

```typescript
    if (method === PYTHON_NOTIFICATION_METHODS.ALBUM_PROGRESS) {
      const p = params as Record<string, unknown>
      mainWindow?.webContents.send(NOTIFICATION_CHANNELS.ALBUM_PROGRESS, p)
      return
    }
```

- [ ] **Step 5: 运行现有测试确认无回归**

Run: `npm test` 和 `pytest tests/ -v`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add python/ipc_server.py shared/types.ts electron/main.ts electron/preload.ts
git commit -m "feat(ipc): 注册 force_pack_album / get_album_progress channel + album_progress 通知"
```

---

## Task 8: 前端 — useIpc hook + DownloadPage 专辑聚合

**Files:**
- Modify: `src/hooks/useIpc.ts`
- Modify: `src/pages/DownloadPage.tsx`

- [ ] **Step 1: useIpc — 新增 hook**

在 `src/hooks/useIpc.ts` 末尾追加：

```typescript
export function useAlbumProgress() {
  const [progress, setProgress] = useState<Record<string, {
    sourceSite: string
    albumId: string
    event: string
    outputPath?: string
    chaptersOnDisk?: number
    totalChapters?: number
  }>>({})

  useEffect(() => {
    if (!window.hcomic?.onAlbumProgress) return
    const unsubscribe = window.hcomic.onAlbumProgress((data) => {
      setProgress(prev => ({ ...prev, [`${data.sourceSite}_${data.albumId}`]: data }))
    })
    return unsubscribe
  }, [])

  return { albumProgress: progress }
}

export function useAlbumCommands() {
  const { invoke } = useIpc()
  return useMemo(() => ({
    forcePackAlbum: (sourceSite: string, albumId: string, overwrite?: boolean) =>
      invoke(() => window.hcomic!.forcePackAlbum(sourceSite, albumId, overwrite)),
    getAlbumProgress: (sourceSite: string, albumId: string) =>
      invoke(() => window.hcomic!.getAlbumProgress(sourceSite, albumId)),
  }), [invoke])
}
```

- [ ] **Step 2: DownloadPage — 专辑卡聚合**

修改 `src/pages/DownloadPage.tsx`，在现有任务列表渲染逻辑之前，增加专辑分组逻辑：

```typescript
// 在 DownloadPage 组件内，tasks 状态之后：
const { forcePackAlbum } = useAlbumCommands()
const { albumProgress } = useAlbumProgress()

// 专辑分组：按 (sourceSite, albumId) 分组多章专辑任务
const albumGroups = useMemo(() => {
  const groups = new Map<string, {
    albumId: string
    sourceSite: string
    albumTitle: string
    tasks: typeof tasks
    totalChapters: number
  }>()
  for (const task of tasks) {
    const albumId = task.comic.albumId
    const total = task.comic.albumTotalChapters ?? 1
    if (!albumId || total <= 1) continue
    const key = `${task.comic.sourceSite ?? 'hcomic'}_${albumId}`
    if (!groups.has(key)) {
      groups.set(key, {
        albumId,
        sourceSite: task.comic.sourceSite ?? 'hcomic',
        albumTitle: task.comic.albumTitle ?? task.comic.title,
        tasks: [],
        totalChapters: total,
      })
    }
    groups.get(key)!.tasks.push(task)
  }
  return groups
}, [tasks])

// 分离：哪些 task 属于专辑，哪些是独立任务
const albumTaskIds = useMemo(() => {
  const ids = new Set<string>()
  for (const g of albumGroups.values()) {
    for (const t of g.tasks) ids.add(t.id)
  }
  return ids
}, [albumGroups])
```

在渲染列表时，先渲染专辑卡（每个专辑一张），再渲染独立任务卡：

```tsx
<div className="space-y-3">
  {/* 专辑卡 */}
  {[...albumGroups.entries()].map(([key, group]) => {
    const completed = group.tasks.filter(t => t.status === 'completed').length
    const hasFailures = group.tasks.some(t => t.status === 'failed')
    const ap = albumProgress[key]
    const isPacked = ap?.event === 'packed'

    return (
      <div key={key} className="bg-[var(--bg-primary)] rounded-xl p-4 shadow-sm border-l-4 border-[var(--accent)]">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-[var(--text-primary)] truncate">
            {group.albumTitle}
          </h3>
          <div className="flex gap-1.5 flex-shrink-0 ml-2">
            {!isPacked && completed > 0 && (
              <button
                onClick={() => forcePackAlbum(group.sourceSite, group.albumId)}
                className="text-xs px-2 py-0.5 rounded bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
              >
                强制打包
              </button>
            )}
          </div>
        </div>
        <div className="text-xs text-[var(--text-secondary)] mb-2">
          {isPacked ? '已打包' : `${completed}/${group.totalChapters} 章完成`}
          {hasFailures && ' (有失败)'}
        </div>
        <ProgressBar
          progress={Math.round((completed / group.totalChapters) * 100)}
          status={isPacked ? 'completed' : 'downloading'}
          totalPages={group.totalChapters}
          downloadedPages={completed}
        />
        {/* 章节子行 */}
        <div className="mt-2 space-y-1">
          {group.tasks.map(task => (
            <div key={task.id} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-[var(--bg-secondary)]">
              <span className="truncate">{task.comic.title}</span>
              <span className="text-[var(--text-secondary)]">{task.status}</span>
            </div>
          ))}
        </div>
      </div>
    )
  })}

  {/* 独立任务卡（不属于专辑或单章） */}
  {tasks.filter(t => !albumTaskIds.has(t.id)).filter(t => matchStatusFilter(t.status, statusFilter)).map((task) => (
    // ... 现有卡片渲染逻辑保持不变 ...
  ))}
</div>
```

- [ ] **Step 3: 运行前端测试**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useIpc.ts src/pages/DownloadPage.tsx
git commit -m "feat(frontend): 专辑卡聚合视图 + 强制打包按钮 + album_progress 通知监听"
```

---

## Task 9: 集成验证 — 端到端测试

**Files:**
- Create: `tests/test_album_integration.py`

- [ ] **Step 1: 编写集成测试**

```python
"""tests/test_album_integration.py — 专辑下载端到端集成测试。"""

import os
import shutil
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from album_coordinator import AlbumStagingCoordinator
from cbz_builder import CBZBuilder
from download_manager import ComicDownloadManager
from downloader import DownloadResult
from models import ComicInfo, DownloadStatus, DownloadTask


class TestAlbumFolderIntegration:
    """output_format=folder 模式：专辑文件夹/章节文件夹/图片。"""

    def test_chapter_lands_in_album_folder(self, tmp_path):
        output_dir = str(tmp_path / "output")
        os.makedirs(output_dir)

        downloader = MagicMock()
        cbz_builder = CBZBuilder()
        manager = ComicDownloadManager(
            downloader=downloader,
            cbz_builder=cbz_builder,
            output_dir=output_dir,
            output_format="folder",
        )
        coordinator = AlbumStagingCoordinator(
            download_dir_provider=lambda: output_dir,
            output_format_provider=lambda: "folder",
        )
        manager.set_album_coordinator(coordinator)

        comic = ComicInfo(
            id="ch1", title="Album - Ch1", source_site="jmcomic",
            comic_source="JMCOMIC", album_id="album1", album_title="Album",
            album_total_chapters=3, author="Auth", pages=2,
        )
        task = DownloadTask(comic=comic, status=DownloadStatus.DOWNLOADING)
        manager.tasks[task.task_id] = task

        temp_dir = tmp_path / "temp_jmcomic_ch1"
        temp_dir.mkdir()
        (temp_dir / "001.jpg").write_bytes(b"\xff\xd8\xff\xd9")
        (temp_dir / "002.jpg").write_bytes(b"\xff\xd8\xff\xd9")

        result = DownloadResult(
            success=True, completed_pages=[1, 2], failed_pages=[],
            temp_dir=str(temp_dir),
        )
        manager._handle_album_chapter_success(task, result)

        album_dir = Path(output_dir) / "Auth-Album"
        chapter_dir = album_dir / "Ch1"
        assert chapter_dir.exists()
        assert (chapter_dir / "001.jpg").exists()
        assert (chapter_dir / "002.jpg").exists()
        assert not temp_dir.exists()


class TestAlbumCbzIntegration:
    """output_format=cbz 模式：齐套后自动打包为专辑 cbz。"""

    def test_auto_pack_on_completion(self, tmp_path):
        output_dir = str(tmp_path / "output")
        os.makedirs(output_dir)

        downloader = MagicMock()
        cbz_builder = CBZBuilder()
        manager = ComicDownloadManager(
            downloader=downloader,
            cbz_builder=cbz_builder,
            output_dir=output_dir,
            output_format="cbz",
        )
        coordinator = AlbumStagingCoordinator(
            download_dir_provider=lambda: output_dir,
            output_format_provider=lambda: "cbz",
        )
        manager.set_album_coordinator(coordinator)

        base_comic_kwargs = dict(
            source_site="jmcomic", comic_source="JMCOMIC",
            album_id="album1", album_title="Album",
            album_total_chapters=2, author="Auth", pages=1,
        )

        for chap_num, chap_name in [(1, "Ch1"), (2, "Ch2")]:
            comic = ComicInfo(
                id=f"ch{chap_num}", title=f"Album - {chap_name}",
                **base_comic_kwargs,
            )
            task = DownloadTask(comic=comic, status=DownloadStatus.DOWNLOADING)
            manager.tasks[task.task_id] = task

            temp_dir = tmp_path / f"temp_jmcomic_ch{chap_num}"
            temp_dir.mkdir()
            (temp_dir / "001.jpg").write_bytes(b"\xff\xd8\xff\xd9")

            result = DownloadResult(
                success=True, completed_pages=[1], failed_pages=[],
                temp_dir=str(temp_dir),
            )
            manager._handle_album_chapter_success(task, result)

        # 第 2 章完成后应自动打包
        cbz_path = Path(output_dir) / "Auth-Album.cbz"
        assert cbz_path.exists()
        # 工作目录应被删除
        assert not (Path(output_dir) / "Auth-Album").is_dir()
```

- [ ] **Step 2: 运行集成测试**

Run: `pytest tests/test_album_integration.py -v`
Expected: 全部 PASS

- [ ] **Step 3: 运行全部测试确认无回归**

Run: `pytest tests/ -v`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add tests/test_album_integration.py
git commit -m "test: 专辑文件夹布局端到端集成测试（folder + cbz 模式）"
```

---

## Task 10: 修复 download_mixin 冲突检测中的 _get_chapter_display_name

**Files:**
- Modify: `python/ipc/download_mixin.py`

- [ ] **Step 1: 确认 _build_and_prepare_comic 返回的 comic 有 album_title**

检查 `_build_and_prepare_comic` 方法。当用户从详情页点击下载时，`comic_data` 中没有 `albumTitle` 字段（只有 title = "Album - Ch1" 这种合成标题）。需要确保 `album_title` 被正确传播。

在 `_build_and_prepare_comic` 方法中（或 `handle_check_download_conflict` 内），当检测到 `comic_data` 有 `albumTotalChapters > 1` 时，手动设置 `comic.album_title`：

```python
    def handle_check_download_conflict(self, comic_data: dict) -> dict:
        comic = self._build_and_prepare_comic(comic_data or {})

        # 多章专辑：从 comic_data 补充 album_title（_build_and_prepare_comic 不一定有）
        if comic_data.get("albumTotalChapters", 1) > 1 and not comic.album_title:
            comic.album_title = comic_data.get("title", "")

        # 多章专辑：检查专辑文件夹内是否有该章子文件夹
        if comic.is_album_chapter:
            album_dir_name = self.cbz_builder.get_album_folder_name(comic)
            album_work_dir = os.path.join(self.config.download_dir, album_dir_name)
            chapter_name = self._get_chapter_display_name(comic)
            chapter_path = os.path.join(album_work_dir, chapter_name)
            has_conflict = os.path.exists(chapter_path)
            return {
                "hasConflict": has_conflict,
                "path": chapter_path,
            }

        output_path = self.cbz_builder.get_output_path_for_format(
            comic, self.config.output_format, self.config.download_dir
        )
        return {
            "hasConflict": os.path.exists(output_path),
            "path": output_path,
        }
```

- [ ] **Step 2: 运行全部测试**

Run: `pytest tests/ -v`
Expected: 全部 PASS

- [ ] **Step 3: Commit**

```bash
git add python/ipc/download_mixin.py
git commit -m "fix(ipc): handle_check_download_conflict 多章场景下正确设置 album_title"
```

---

## 完成清单

- [ ] 所有 Task 的所有 Step 均已完成
- [ ] `pytest tests/ -v` 全部 PASS
- [ ] `npm test` 全部 PASS
- [ ] 手动验证：下载 3 章 jmcomic 专辑（folder + cbz 两种格式），文件布局符合 spec
- [ ] 规范文档 `docs/superpowers/specs/2026-06-12-album-folder-layout-design.md` 状态更新为 "Approved"
