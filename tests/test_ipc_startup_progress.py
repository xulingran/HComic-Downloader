"""IPCServer._emit_progress 单元测试。

验证启动进度信号的产生：
- stderr 输出格式 `PROGRESS:<percent>:<label>`
- flush 行为（立即送达，不被缓冲）
- 走 stderr 而非 stdout（stdout 仅用于 JSON-RPC 响应）

对应 spec：startup-progress-feedback / 需求:启动期进度信号产生
"""

import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(
    0,
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"),
)

from python.ipc_server import IPCServer  # noqa: E402


class TestEmitProgress:
    """验证 _emit_progress 的 stderr 输出契约。"""

    def test_outputs_correct_format_to_stderr(self, capsys):
        """格式必须为 PROGRESS:<percent>:<label>，写入 stderr。"""
        # _emit_progress 不依赖实例状态，用 MagicMock 规避 __init__ 全流程
        server = IPCServer.__new__(IPCServer)
        server._emit_progress(50, "下载引擎已就绪")

        captured = capsys.readouterr()
        assert captured.out == "", "进度信号禁止写入 stdout"
        assert captured.err == "PROGRESS:50:下载引擎已就绪\n", f"stderr 格式错误：{captured.err!r}"

    def test_flush_is_true(self):
        """flush=True 确保 PythonBridge 立即收到，不被缓冲延迟。"""
        server = IPCServer.__new__(IPCServer)
        with patch("builtins.print") as mock_print:
            server._emit_progress(25, "配置已加载")
            mock_print.assert_called_once()
            _, kwargs = mock_print.call_args
            assert kwargs.get("flush") is True, "必须 flush=True"
            assert kwargs.get("file") is sys.stderr, "必须写入 sys.stderr"

    def test_zero_percent(self, capsys):
        """边界：percent=0 应正常输出。"""
        server = IPCServer.__new__(IPCServer)
        server._emit_progress(0, "准备启动")
        assert capsys.readouterr().err == "PROGRESS:0:准备启动\n"

    def test_hundred_percent(self, capsys):
        """边界：percent=100 应正常输出。"""
        server = IPCServer.__new__(IPCServer)
        server._emit_progress(100, "完成")
        assert capsys.readouterr().err == "PROGRESS:100:完成\n"

    def test_does_not_touch_stdout(self, capsys):
        """stdout 必须保持纯净（仅用于 JSON-RPC 响应），ready gate 契约不受影响。"""
        server = IPCServer.__new__(IPCServer)
        server._emit_progress(95, "准备就绪")
        captured = capsys.readouterr()
        assert captured.out == ""

    def test_chinese_label_preserved(self, capsys):
        """中文 label 必须原样输出，不转义不截断。"""
        server = IPCServer.__new__(IPCServer)
        server._emit_progress(85, "数据库已就绪")
        assert "数据库已就绪" in capsys.readouterr().err
