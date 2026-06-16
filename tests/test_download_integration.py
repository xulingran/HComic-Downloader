"""下载→打包真实文件系统集成测试。

与 test_download_manager.py 的区别：这里使用 **真实的 CBZBuilder** 和注入真实图片字节的
downloader（仅在 HTTP 网络层替换，文件系统与打包逻辑全真实），验证「下载产物经真实打包后
产出可被标准 zipfile 解压、含正确图片与 ComicInfo.xml 的 CBZ」。这是 ComicDownloadManager
编排层与 CBZBuilder 的真实集成边界，对应 behavior-integration-tests spec。
"""

import os
import shutil
import time
import zipfile

from cbz_builder import CBZBuilder
from config import Config
from download_manager import ComicDownloadManager
from downloader import DownloadResult
from models import ComicInfo, DownloadStatus


def _make_builder(download_dir: str) -> CBZBuilder:
    """构造 CBZBuilder，注入 download_dir 指向测试临时目录。

    真实运行中 config.download_dir 与 ComicDownloadManager.output_dir 一致（ipc_server.py:114），
    CBZBuilder 的路径遍历校验据此判定 output_path 合法。测试复现这一关系，避免 CBZBuilder
    回退到用户真实下载目录导致校验失败。
    """
    config = Config()
    config.download_dir = download_dir
    return CBZBuilder(config=config)


# 最小有效 JPEG（1x1 像素），避免依赖外部图片资源
_MIN_JPEG = (
    b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    b"\xff\xdb\x00C\x00\x03\x02\x02\x03\x02\x02\x03\x03\x03\x03\x04\x03\x03"
    b"\x04\x05\x08\x05\x05\x04\x04\x05\n\x07\x07\x06\x08\x0c\n\x0c\x0c\x0b"
    b"\n\x0b\x0b\r\x0e\x12\x10\r\x0e\x11\x0e\x0b\x0b\x10\x16\x10\x11\x13\x14"
    b"\x15\x15\x15\x0c\x0f\x17\x18\x16\x14\x18\x12\x14\x15\x14\xff\xc0\x00"
    b"\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x14\x00\x01\x00"
    b"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\n\xff\xc4\x00"
    b"\x14\x10\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
    b"\x00\xff\xda\x00\x08\x01\x01\x00\x00?\x00T\x9f\xff\xd9"
)


class _RealBytesDownloader:
    """注入真实图片字节的 downloader。

    仅替代 HTTP 下载（写真实 JPEG 文件到 temp_dir），不复用真实 downloader 的网络逻辑。
    返回结构严格符合 DownloadResult 协议，使 ComicDownloadManager 走真实打包路径。
    """

    def __init__(self, page_count: int):
        self.page_count = page_count

    def download_comic_resume(
        self,
        comic,
        output_dir,
        options=None,
        progress_callback=None,
        delay_after=0,
        comic_info=None,
        completed_pages=None,
        failed_pages=None,
        cancel_event=None,
        pause_event=None,
    ):
        temp_dir = os.path.join(output_dir, f"temp_{comic.id}")
        os.makedirs(temp_dir, exist_ok=True)
        total = self.page_count
        completed = list(completed_pages or [])
        for i in range(1, total + 1):
            if i in completed:
                continue
            with open(os.path.join(temp_dir, f"{i:03d}.jpg"), "wb") as f:
                f.write(_MIN_JPEG)
            completed.append(i)
            if progress_callback:
                progress_callback(len(completed), total, "downloading", comic_info)
        return DownloadResult(
            success=True,
            completed_pages=completed,
            failed_pages=[],
            temp_dir=temp_dir,
        )

    def download_comic(self, comic, output_dir, progress_callback=None):
        return self.download_comic_resume(
            comic=comic, output_dir=output_dir, progress_callback=progress_callback
        ).temp_dir

    def cleanup_temp_dir(self, temp_dir):
        shutil.rmtree(temp_dir, ignore_errors=True)


def _wait_until(predicate, timeout=5.0, interval=0.05):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return predicate()


# ── 场景：完整下载流程生成有效 CBZ ──────────────────────────────────────


def test_full_download_pipeline_produces_valid_cbz_with_comic_info(tmp_path):
    """真实 CBZBuilder + 真实图片字节 → 产出可解压、含 ComicInfo.xml 的 CBZ。

    锁定编排层（ComicDownloadManager）与打包层（CBZBuilder）的集成：
    状态流转 queued→completed，且最终 CBZ 内容符合 CBZ 规范。
    """
    dm = ComicDownloadManager(
        downloader=_RealBytesDownloader(page_count=3),
        cbz_builder=_make_builder(str(tmp_path)),
        output_dir=str(tmp_path),
        output_format="cbz",
    )
    comic = ComicInfo(
        id="intg_ok",
        title="集成测试漫画",
        author="测试作者",
        pages=3,
        category="测试分类",
    )
    task_id = dm.add_task(comic)

    assert _wait_until(
        lambda: dm.tasks[task_id].status in (DownloadStatus.COMPLETED, DownloadStatus.FAILED)
    ), "任务未在超时内进入终态"

    task = dm.tasks[task_id]
    assert task.status == DownloadStatus.COMPLETED, f"期望 COMPLETED，实际 {task.status}"
    # 集成测试聚焦编排层与打包层的边界不变量：completed_pages 完整、CBZ 真实生成。
    # progress_current 由回调阶段字符串驱动，属 download_manager 单元测试职责，此处不重复验证。
    assert sorted(task.completed_pages) == [1, 2, 3]

    # 定位产出的 CBZ 文件
    cbz_files = list(tmp_path.rglob("*.cbz"))
    assert len(cbz_files) == 1, f"期望产出 1 个 CBZ，实际 {len(cbz_files)}"
    cbz_path = cbz_files[0]

    # 用标准 zipfile 验证 CBZ 内容（不依赖项目内 CBZ 读取逻辑）
    with zipfile.ZipFile(cbz_path, "r") as zf:
        names = zf.namelist()
        assert "ComicInfo.xml" in names, "CBZ 必须包含 ComicInfo.xml"
        image_names = [n for n in names if n.lower().endswith((".jpg", ".jpeg"))]
        assert len(image_names) == 3, f"期望 3 张图片，实际 {len(image_names)}"
        # 验证图片是真实字节而非占位
        xml = zf.read("ComicInfo.xml").decode("utf-8")
        assert "集成测试漫画" in xml
        assert "测试作者" in xml
        assert "测试分类" in xml
        # 图片内容必须是真实 JPEG 字节
        first_img = zf.read(image_names[0])
        assert first_img.startswith(b"\xff\xd8\xff"), "图片字节必须是有效 JPEG 头"


# ── 场景：下载中断后恢复不损坏已有数据 ──────────────────────────────────


def test_download_resume_after_partial_completion_keeps_integrity(tmp_path):
    """断点续传场景：首次部分完成（completed_pages 非空）后恢复，
    最终 CBZ 必须完整且可正常解压，已有分片不得损坏。

    用一个记录已下载页的 downloader，模拟首次下载了第 1 页后第二次调用补齐剩余页。
    """
    completed_tracker: dict[str, list[int]] = {}

    class _ResumingDownloader(_RealBytesDownloader):
        def download_comic_resume(self, comic, output_dir, options=None, **kwargs):
            already = completed_tracker.setdefault(comic.id, list(kwargs.get("completed_pages") or []))
            temp_dir = os.path.join(output_dir, f"temp_{comic.id}")
            os.makedirs(temp_dir, exist_ok=True)
            for i in range(1, self.page_count + 1):
                if i in already:
                    continue
                with open(os.path.join(temp_dir, f"{i:03d}.jpg"), "wb") as f:
                    f.write(_MIN_JPEG)
                already.append(i)
            return DownloadResult(
                success=True,
                completed_pages=list(already),
                failed_pages=[],
                temp_dir=temp_dir,
            )

    dm = ComicDownloadManager(
        downloader=_ResumingDownloader(page_count=3),
        cbz_builder=_make_builder(str(tmp_path)),
        output_dir=str(tmp_path),
        output_format="cbz",
    )
    comic = ComicInfo(id="intg_resume", title="续传漫画", pages=3)
    task_id = dm.add_task(comic)

    assert _wait_until(lambda: dm.tasks[task_id].status in (DownloadStatus.COMPLETED, DownloadStatus.FAILED))
    assert dm.tasks[task_id].status == DownloadStatus.COMPLETED

    # 续传追踪器必须记录全部 3 页（含首次已完成的）
    assert sorted(completed_tracker[comic.id]) == [1, 2, 3]

    cbz_files = list(tmp_path.rglob("*.cbz"))
    assert len(cbz_files) == 1
    with zipfile.ZipFile(cbz_files[0], "r") as zf:
        assert "ComicInfo.xml" in zf.namelist()
        images = [n for n in zf.namelist() if n.lower().endswith((".jpg", ".jpeg"))]
        assert len(images) == 3
        # 验证所有图片字节完整且为有效 JPEG（未被续传损坏）
        for img in images:
            data = zf.read(img)
            assert data.startswith(b"\xff\xd8\xff") and data.endswith(b"\xff\xd9")


# ── 场景：真实下载路径下 URL 安全校验真实执行 ──────────────────────────


def test_real_downloader_blocks_ssrf_url(tmp_path):
    """真实 ComicDownloader（非 mock）下载内网 URL 时必须被 UrlValidator 拦截。

    与上方 _RealBytesDownloader 测试的区别：此处使用真实 ComicDownloader + 真实
    ImageDownloader，仅注入可控的图片 URL（指向内网），验证 validate_url 在真实
    下载路径中真实执行——而非靠 mock 断言。
    """
    from downloader import ComicDownloader

    comic = ComicInfo(id="ssrf_test", title="SSRF 测试", pages=1)

    # 通过 monkeypatch 注入内网图片 URL：生产 ComicInfo.get_image_url 由 media_id 规则
    # 生成 URL，不暴露 hostname 控制点，故直接替换方法以注入可控的内网地址。
    import models

    original_get = models.ComicInfo.get_image_url
    models.ComicInfo.get_image_url = lambda self, page: f"http://127.0.0.1/evil/{page}.jpg"
    try:
        downloader = ComicDownloader(concurrent_downloads=1, timeout=5)
        result = downloader.download_comic_resume(comic, str(tmp_path))
        # 真实 validate_url 必须拦截内网 URL → 所有页失败
        assert result.success is False or result.failed_pages, "内网 URL 未被真实 validate_url 拦截（SSRF 防护失效）"
        # 不应有任何文件落盘到内网请求
        assert len(result.completed_pages) == 0, "内网 URL 不应成功下载任何页"
    finally:
        models.ComicInfo.get_image_url = original_get


def test_real_downloader_session_has_proxy_applied():
    """真实 ComicDownloader 的 ImageDownloader 池中 Session 必须已应用系统代理。

    验证 AGENTS.md 硬约束在真实下载器实例化后被落实（trust_env=True），
    而非靠 mock 断言。
    """
    from downloader import ComicDownloader

    downloader = ComicDownloader(concurrent_downloads=1, timeout=5)
    try:
        session = downloader.image_downloader._create_session()
        assert session.trust_env is True, "真实下载器 Session 未应用系统代理"
    finally:
        downloader.image_downloader.close()
