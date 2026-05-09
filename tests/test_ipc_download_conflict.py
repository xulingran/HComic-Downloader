"""Tests for download conflict detection in IPCServer."""
import os
import sys
import pytest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"))

from models import ComicInfo
from python.ipc_server import IPCServer


@pytest.fixture
def ipc_server(tmp_path):
    with patch('python.ipc_server._get_config_path', return_value=str(tmp_path / 'config.json')):
        server = IPCServer()
    yield server
    server._download_manager.stop()
    server._download_manager.wait_active_downloads(timeout=5)


def _resolve_output_path(server, comic_id, title, source_site="hcomic"):
    comic = ComicInfo(id=comic_id, title=title, source_site=source_site)
    return server.cbz_builder.get_output_path_for_format(
        comic, server.config.output_format, server.config.download_dir
    )


def test_check_download_conflict_no_conflict(ipc_server, tmp_path):
    result = ipc_server.handle_check_download_conflict(comic_data={
        "id": "noconflict", "title": "No Conflict", "sourceSite": "hcomic"
    })
    assert result["hasConflict"] is False
    assert "path" in result


def test_check_download_conflict_with_conflict(ipc_server, tmp_path):
    output_path = _resolve_output_path(ipc_server, "conflict1", "Conflict Comic")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w') as f:
        f.write("existing")

    result = ipc_server.handle_check_download_conflict(comic_data={
        "id": "conflict1", "title": "Conflict Comic", "sourceSite": "hcomic"
    })
    assert result["hasConflict"] is True


def test_download_returns_conflict_without_overwrite(ipc_server, tmp_path):
    output_path = _resolve_output_path(ipc_server, "conflict2", "Conflict Comic 2")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w') as f:
        f.write("existing")

    result = ipc_server.handle_download(comic_id="conflict2", comic_data={
        "title": "Conflict Comic 2", "sourceSite": "hcomic"
    })
    assert result["status"] == "conflict"
    assert result["taskId"] is None
    assert result["conflictPath"] == output_path


def test_download_proceeds_with_overwrite(ipc_server, tmp_path):
    result = ipc_server.handle_download(comic_id="overwrite1", comic_data={
        "title": "Overwrite Comic", "sourceSite": "hcomic"
    }, overwrite=True)
    assert result["status"] in ("queued", "downloading")
    assert result["taskId"] is not None


def test_download_no_conflict_proceeds_without_overwrite(ipc_server, tmp_path):
    result = ipc_server.handle_download(comic_id="nooverwrite", comic_data={
        "title": "No Overwrite Needed", "sourceSite": "hcomic"
    })
    assert result["status"] in ("queued", "downloading")
    assert result["taskId"] is not None
