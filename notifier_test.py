"""系统通知模块测试脚本"""
import logging
import platform
import sys
from pathlib import Path

# 添加项目根目录到路径
sys.path.insert(0, str(Path(__file__).parent))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def test_build_notification_body():
    """测试通知内容构建"""
    from notifier import build_notification_body

    # 测试全部成功
    title, body, on_success = build_notification_body(
        completed=10, failed=0, failed_list=[]
    )
    assert title == "HComic Downloader"
    assert "成功: 10 本" in body
    assert on_success is True
    logger.info("✓ 全部成功通知内容正确")

    # 测试有失败
    title, body, on_success = build_notification_body(
        completed=8, failed=5,
        failed_list=[
            ("漫画A", "网络超时"),
            ("漫画B", "页面解析失败"),
            ("漫画C", "文件写入错误"),
        ]
    )
    assert "成功: 8 本" in body
    assert "失败: 5 本" in body
    assert "漫画A" in body
    assert "网络超时" in body
    assert on_success is False
    logger.info("✓ 有失败通知内容正确")

    # 测试超长内容截断
    long_name = "这是一个非常非常非常非常非常非常长的漫画标题"
    long_error = "ConnectionTimeout: Read timed out. The read operation timed out after 30 seconds"
    title, body, on_success = build_notification_body(
        completed=1, failed=1,
        failed_list=[(long_name, long_error)]
    )
    assert "..." in body
    logger.info("✓ 超长内容截断正确")


def test_truncate():
    """测试截断函数"""
    from notifier import _truncate

    assert _truncate("短文本", 20) == "短文本"
    long_text = "这是一个超过二十个字符的长文本测试用来验证截断功能是否正常工作"
    result = _truncate(long_text, 20)
    assert len(result) == 20
    assert result.endswith("...")
    logger.info("✓ 截断函数正确")


def test_system_notifier_init():
    """测试 SystemNotifier 初始化"""
    try:
        import tkinter as tk
        from config import Config
        from notifier import SystemNotifier

        # 创建隐藏的 root 窗口
        root = tk.Tk()
        root.withdraw()

        config = Config()
        notifier = SystemNotifier(root, config)

        logger.info(f"✓ SystemNotifier 初始化成功，后端: {notifier.backend}")

        # 测试 should_notify
        result = notifier.should_notify()
        logger.info(f"✓ should_notify 返回: {result}")

        root.destroy()

    except Exception as e:
        logger.error(f"✗ SystemNotifier 初始化失败: {e}")


def test_windows_protocol():
    """测试 Windows 协议注册"""
    if platform.system() != "Windows":
        logger.info("⊘ 跳过 Windows 协议测试（非 Windows 平台）")
        return

    try:
        from protocol_register import is_protocol_registered, register_protocol

        # 检测状态
        status = is_protocol_registered()
        logger.info(f"✓ 协议状态检测成功: {'已注册' if status else '未注册'}")

    except Exception as e:
        logger.error(f"✗ Windows 协议测试失败: {e}")


def test_notify_windows():
    """测试 Windows 通知"""
    if platform.system() != "Windows":
        logger.info("⊘ 跳过 Windows 通知测试（非 Windows 平台）")
        return

    try:
        from notifier import _WindowsNotifier, _get_icon_path

        icon_path = _get_icon_path()
        notifier = _WindowsNotifier(icon_path)

        result = notifier.notify("测试通知", "这是一条测试通知", True)
        if result:
            logger.info("✓ Windows 通知发送成功")
        else:
            logger.warning("✗ Windows 通知发送失败")

    except ImportError:
        logger.warning("⊘ winotify 未安装，跳过测试")
    except Exception as e:
        logger.error(f"✗ Windows 通知测试失败: {e}")


def test_notify_macos():
    """测试 macOS 通知"""
    if platform.system() != "Darwin":
        logger.info("⊘ 跳过 macOS 通知测试（非 macOS 平台）")
        return

    try:
        from notifier import _MacOsascriptNotifier

        notifier = _MacOsascriptNotifier()
        result = notifier.notify("测试通知", "这是一条测试通知", True)
        if result:
            logger.info("✓ macOS 通知发送成功")
        else:
            logger.warning("✗ macOS 通知发送失败")

    except Exception as e:
        logger.error(f"✗ macOS 通知测试失败: {e}")


def test_notify_linux():
    """测试 Linux 通知"""
    if platform.system() != "Linux":
        logger.info("⊘ 跳过 Linux 通知测试（非 Linux 平台）")
        return

    try:
        from notifier import _LinuxNotifySend, _get_icon_path

        icon_path = _get_icon_path()
        notifier = _LinuxNotifySend(icon_path)

        result = notifier.notify("测试通知", "这是一条测试通知", True)
        if result:
            logger.info("✓ Linux 通知发送成功")
        else:
            logger.warning("✗ Linux 通知发送失败")

    except Exception as e:
        logger.error(f"✗ Linux 通知测试失败: {e}")


if __name__ == "__main__":
    print("=" * 50)
    print("系统通知模块测试")
    print("=" * 50)
    print()

    test_truncate()
    test_build_notification_body()
    test_system_notifier_init()
    test_windows_protocol()
    test_notify_windows()
    test_notify_macos()
    test_notify_linux()

    print()
    print("=" * 50)
    print("测试完成")
    print("=" * 50)
