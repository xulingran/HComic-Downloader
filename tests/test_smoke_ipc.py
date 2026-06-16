"""端到端冒烟测试：真实 spawn Python IPCServer 子进程。

验证 JSON-RPC over stdin/stdout 这条最脆弱的进程间通信边界的完整性：
- 真实子进程启动（Config 加载、mixin 组装、日志初始化）
- JSON-RPC 请求/响应往返（序列化、stdin 写入、stdout 读取、JSON 解析）
- 优雅退出（stdin EOF → 子进程退出码 0）

用 @pytest.mark.smoke 标记，可用 `pytest -m "not smoke"` 在快速反馈场景跳过。
对应 behavior-integration-tests spec 的端到端冒烟需求。
"""

import json
import os
import subprocess
import sys

import pytest

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_IPC_SERVER = os.path.join(_PROJECT_ROOT, "python", "ipc_server.py")

# 冒烟测试超时（秒）：子进程启动 + Config 加载 + 请求往返的充裕上限
_SMOKE_TIMEOUT = 15

smoke = pytest.mark.smoke


def _send_rpc(proc: subprocess.Popen, req: dict) -> dict:
    """向子进程 stdin 写入一行 JSON-RPC 请求，从 stdout 读取一行响应。"""
    line = json.dumps(req) + "\n"
    assert proc.stdin is not None
    assert proc.stdout is not None
    proc.stdin.write(line)
    proc.stdin.flush()
    raw = proc.stdout.readline()
    assert raw, "子进程未在超时内返回响应（stdout 为空）"
    return json.loads(raw)


@smoke
def test_real_subprocess_responds_to_get_config():
    """真实 spawn ipc_server.py，发送 get_config，验证收到合法 JSON-RPC 响应。

    守护进程间通信边界：若 Python 端启动崩溃、JSON 序列化断裂、stdin/stdout
    管道异常，此测试必须失败。
    """
    proc = subprocess.Popen(
        [sys.executable, _IPC_SERVER],
        cwd=_PROJECT_ROOT,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    try:
        resp = _send_rpc(proc, {"jsonrpc": "2.0", "id": 1, "method": "get_config", "params": {}})
        assert resp["jsonrpc"] == "2.0"
        assert resp["id"] == 1
        assert "result" in resp, f"响应缺少 result 字段: {resp}"
        config = resp["result"]["config"]
        assert isinstance(config, dict)
        # 核心契约字段必须存在（与 test_ipc_contract 呼应，但这里是经真实管道传输后验证）
        for key in ("themeMode", "outputFormat", "downloadDir", "defaultSource"):
            assert key in config, f"真实管道传输后 config 缺少 {key}"
    finally:
        # 关闭 stdin 触发优雅退出
        if proc.stdin:
            proc.stdin.close()
        try:
            proc.wait(timeout=_SMOKE_TIMEOUT)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
            pytest.fail("子进程未在优雅退出超时内结束")


@smoke
def test_real_subprocess_graceful_shutdown_on_eof():
    """关闭 stdin（EOF）后，子进程必须在合理时间内优雅退出（退出码 0）。

    验证 _stdin_reader_loop 的 EOF 信号路径 → _stop_event → _shutdown_executors → 退出。
    """
    proc = subprocess.Popen(
        [sys.executable, _IPC_SERVER],
        cwd=_PROJECT_ROOT,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    # 先发一个 get_config 确认子进程就绪
    _send_rpc(proc, {"jsonrpc": "2.0", "id": 1, "method": "get_config", "params": {}})

    # 关闭 stdin 触发 EOF 退出
    assert proc.stdin is not None
    proc.stdin.close()
    exit_code = proc.wait(timeout=_SMOKE_TIMEOUT)
    assert exit_code == 0, f"期望优雅退出码 0，实际 {exit_code}"
