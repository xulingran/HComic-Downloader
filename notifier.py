"""系统通知模块 - 支持 Windows、macOS、Linux 三平台"""
from __future__ import annotations

import logging
import platform
import subprocess
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Callable, Optional

if TYPE_CHECKING:
    import tkinter as tk
    from config import Config

logger = logging.getLogger(__name__)

_SYSTEM = platform.system()
_IS_WINDOWS = _SYSTEM == "Windows"
_IS_MACOS = _SYSTEM == "Darwin"
_IS_LINUX = _SYSTEM == "Linux"


def _get_icon_path() -> Optional[Path]:
    """获取图标文件路径，支持开发环境和打包后环境"""
    icon_name = "icon_48.png"

    # 策略 1: 相对于可执行文件 (打包后)
    if getattr(sys, 'frozen', False):
        exe_dir = Path(sys.executable).parent
        frozen_path = exe_dir / "assets" / icon_name
        if frozen_path.exists():
            return frozen_path

    # 策略 2: 相对于当前文件 (开发环境)
    dev_path = Path(__file__).parent / "assets" / icon_name
    if dev_path.exists():
        return dev_path

    return None


def _truncate(text: str, max_len: int) -> str:
    """截断超长文本"""
    if len(text) <= max_len:
        return text
    return text[:max_len - 3] + "..."


def build_notification_body(
    completed: int,
    failed: int,
    failed_list: list[tuple[str, str]],
) -> tuple[str, str, bool]:
    """构建通知内容

    Returns:
        (title, body, on_success)
    """
    title = "HComic Downloader"

    if failed == 0:
        body = f"下载队列已完成\n成功: {completed} 本"
        return title, body, True

    body = f"下载队列已完成\n成功: {completed} 本 | 失败: {failed} 本"

    if failed_list:
        body += "\n\n失败:"
        for name, error in failed_list[:3]:
            display_name = _truncate(name, 20)
            display_error = _truncate(error or "未知错误", 40)
            body += f"\n• {display_name}: {display_error}"

        if failed > 3:
            body += f"\n...还有 {failed - 3} 本"

    return title, body, False


class SystemNotifier:
    """系统通知统一接口"""

    def __init__(self, root: tk.Tk, config: Config):
        self._root = root
        self._config = config
        self._icon_path = _get_icon_path()
        self._backend = None
        self._notifier = None

        self._init_backend()

    def _init_backend(self):
        """初始化各平台通知后端"""
        if _IS_WINDOWS:
            self._init_windows()
        elif _IS_MACOS:
            self._init_macos()
        elif _IS_LINUX:
            self._init_linux()

    def _init_windows(self):
        """初始化 Windows 通知后端"""
        try:
            from winotify import Notification
            self._notifier = _WindowsNotifier(self._icon_path)
            self._backend = "winotify"
            logger.info("通知后端: winotify")
            return
        except ImportError:
            logger.warning("winotify 不可用，尝试 PowerShell fallback")

        self._notifier = _WindowsPowerShellNotifier(self._icon_path)
        self._backend = "powershell"
        logger.info("通知后端: PowerShell")

    def _init_macos(self):
        """初始化 macOS 通知后端"""
        try:
            self._notifier = _MacNotifier(self._root)
            if self._notifier.is_available:
                self._backend = "pyobjc"
                logger.info("通知后端: pyobjc UNUserNotificationCenter")
                return
        except Exception as e:
            logger.warning(f"pyobjc 不可用: {e}")

        self._notifier = _MacOsascriptNotifier()
        self._backend = "osascript"
        logger.info("通知后端: osascript (无点击回调)")

    def _init_linux(self):
        """初始化 Linux 通知后端"""
        try:
            self._notifier = _LinuxNotifier(self._icon_path)
            if self._notifier.is_available:
                self._backend = "jeepney"
                logger.info("通知后端: jeepney D-Bus")
                return
        except Exception as e:
            logger.warning(f"jeepney 不可用: {e}")

        self._notifier = _LinuxNotifySend(self._icon_path)
        self._backend = "notify-send"
        logger.info("通知后端: notify-send")

    @property
    def backend(self) -> Optional[str]:
        """当前使用的后端名称"""
        return self._backend

    def request_permission(self) -> bool:
        """请求通知权限 (macOS)"""
        if _IS_MACOS and self._backend == "pyobjc" and self._notifier:
            return self._notifier.request_permission()
        return True

    def should_notify(self) -> bool:
        """检查是否应该发送通知"""
        if not self._config.notify_on_complete:
            return False

        if self._config.notify_when_foreground == "always":
            return True

        # inactive 模式：检查窗口状态
        try:
            state = self._root.state()
            if state in ('iconic', 'withdrawn'):
                return True
            if self._root.focus_get() is None:
                return True
            return False
        except (tk.TclError, AttributeError):
            return True

    def notify(
        self,
        completed: int,
        failed: int,
        failed_list: list[tuple[str, str]],
    ) -> bool:
        """发送系统通知

        Args:
            completed: 成功数量
            failed: 失败数量
            failed_list: 失败列表 [(名称, 原因), ...]

        Returns:
            是否发送成功
        """
        if not self.should_notify():
            logger.debug("跳过通知（窗口在前台或通知已禁用）")
            return False

        title, body, on_success = build_notification_body(completed, failed, failed_list)

        if not self._notifier:
            logger.warning("无可用通知后端")
            return False

        try:
            return self._notifier.notify(title, body, on_success)
        except Exception as e:
            logger.error(f"发送通知失败: {e}")
            return False

    def bring_to_front(self):
        """将应用窗口置于前台"""
        try:
            self._root.deiconify()
            self._root.lift()
            self._root.focus_force()
        except Exception as e:
            logger.error(f"窗口提升失败: {e}")

    def register_protocol(self) -> tuple[bool, str]:
        """注册 Windows URI 协议"""
        if not _IS_WINDOWS:
            return False, "仅支持 Windows 平台"

        try:
            from protocol_register import register_protocol
            return register_protocol()
        except Exception as e:
            return False, str(e)

    def is_protocol_registered(self) -> bool:
        """检测 Windows URI 协议是否已注册"""
        if not _IS_WINDOWS:
            return False

        try:
            from protocol_register import is_protocol_registered
            return is_protocol_registered()
        except (ImportError, OSError):
            return False


class _WindowsNotifier:
    """Windows winotify 通知实现"""

    def __init__(self, icon_path: Optional[Path]):
        self._icon_path = icon_path

    def notify(self, title: str, body: str, on_success: bool) -> bool:
        from winotify import Notification, audio

        toast = Notification(
            app_id="HComic Downloader",
            title=title,
            msg=body,
            icon=str(self._icon_path) if self._icon_path else "",
            launch="hcomic://bring-to-front",
        )

        if on_success:
            toast.set_audio(audio.Default, loop=False)
        else:
            toast.set_audio(audio.Mail, loop=False)

        toast.show()
        return True


class _WindowsPowerShellNotifier:
    """Windows PowerShell 通知实现 (fallback)"""

    def __init__(self, icon_path: Optional[Path]):
        self._icon_path = icon_path

    def notify(self, title: str, body: str, on_success: bool) -> bool:
        # 转义单引号
        safe_title = title.replace("'", "''")
        safe_body = body.replace("'", "''")

        ps_cmd = f'''
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

        $template = @"
<toast>
    <visual>
        <binding template="ToastGeneric">
            <text>{safe_title}</text>
            <text>{safe_body}</text>
        </binding>
    </visual>
</toast>
"@

        $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
        $xml.LoadXml($template)
        $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("HComic Downloader").Show($toast)
        '''

        try:
            subprocess.run(
                ["powershell", "-Command", ps_cmd],
                capture_output=True, timeout=10, check=True
            )
            return True
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
            logger.error(f"PowerShell 通知失败: {e}")
            return False


class _MacNotifier:
    """macOS pyobjc 通知实现"""

    def __init__(self, root: tk.Tk):
        self._root = root
        self._center = None
        self._delegate = None
        self._available = False
        self._permission_granted = False

        try:
            import objc
            from Foundation import NSObject
            from UserNotifications import UNUserNotificationCenter

            self._center = UNUserNotificationCenter.currentNotificationCenter()

            # 创建 delegate 类
            class NotificationDelegate(NSObject):
                _root = root
                _bring_to_front = None

                def userNotificationCenter_didReceiveNotificationResponse_withCompletionHandler_(
                    self, center, response, completionHandler
                ):
                    try:
                        from UserNotifications import UNNotificationDefaultActionIdentifier
                        if response.actionIdentifier() == UNNotificationDefaultActionIdentifier:
                            if self._bring_to_front:
                                self._root.after(0, self._bring_to_front)
                    except Exception as e:
                        logger.error(f"处理通知响应出错: {e}")
                    finally:
                        completionHandler()

                def userNotificationCenter_willPresentNotification_withCompletionHandler_(
                    self, center, notification, completionHandler
                ):
                    try:
                        from UserNotifications import (
                            UNNotificationPresentationOptionBanner,
                            UNNotificationPresentationOptionSound,
                        )
                        completionHandler(
                            UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionSound
                        )
                    except ImportError:
                        try:
                            from UserNotifications import UNNotificationPresentationOptionAlert
                            completionHandler(UNNotificationPresentationOptionAlert)
                        except ImportError:
                            completionHandler(0)

            self._delegate = NotificationDelegate.alloc().init()
            self._delegate._bring_to_front = lambda: self._bring_to_front()
            self._center.setDelegate_(self._delegate)
            self._available = True

        except ImportError as e:
            logger.debug(f"pyobjc 导入失败: {e}")

    @property
    def is_available(self) -> bool:
        return self._available

    def _bring_to_front(self):
        """将窗口置于前台"""
        try:
            self._root.deiconify()
            self._root.lift()
            self._root.focus_force()
        except Exception as e:
            logger.error(f"窗口提升失败: {e}")

    def request_permission(self) -> bool:
        """请求通知权限"""
        if not self._available:
            return False

        def _on_auth(granted, error):
            self._permission_granted = granted
            if error:
                logger.warning(f"权限请求错误: {error}")

        try:
            # 7 = Alert | Sound | Badge
            self._center.requestAuthorizationWithOptions_completionHandler_(7, _on_auth)
            return True
        except Exception as e:
            logger.error(f"请求权限失败: {e}")
            return False

    def notify(self, title: str, body: str, on_success: bool) -> bool:
        if not self._available:
            return False

        try:
            from UserNotifications import (
                UNMutableNotificationContent,
                UNNotificationRequest,
                UNNotificationSound,
            )

            content = UNMutableNotificationContent.alloc().init()
            content.setTitle_(title)
            content.setBody_(body)
            content.setSound_(UNNotificationSound.defaultSound())

            request = UNNotificationRequest.requestWithIdentifier_content_trigger_(
                f"hcomic-{id(title)}-{id(body)}", content, None
            )

            def _on_error(error):
                if error:
                    logger.error(f"发送通知失败: {error}")

            self._center.addNotificationRequest_withCompletionHandler_(request, _on_error)
            return True

        except Exception as e:
            logger.error(f"发送通知异常: {e}")
            return False


class _MacOsascriptNotifier:
    """macOS osascript 通知实现 (fallback)"""

    def notify(self, title: str, body: str, on_success: bool) -> bool:
        safe_title = title.replace('"', '\\"')
        safe_body = body.replace('"', '\\"')
        script = f'display notification "{safe_body}" with title "{safe_title}" sound name "default"'

        try:
            subprocess.run(
                ["osascript", "-e", script],
                capture_output=True, timeout=5, check=True
            )
            return True
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
            logger.error(f"osascript 通知失败: {e}")
            return False


class _LinuxNotifier:
    """Linux jeepney D-Bus 通知实现"""

    def __init__(self, icon_path: Optional[Path]):
        self._icon_path = icon_path
        self._conn = None
        self._available = False
        self._listener_thread = None
        self._notification_id = 0

        try:
            from jeepney.integrate.blocking import connect_and_authenticate
            import jeepney

            self._conn = connect_and_authenticate(bus='SESSION')
            self._notify_addr = jeepney.DBusAddress(
                bus_name='org.freedesktop.Notifications',
                object_path='/org/freedesktop/Notifications',
                interface='org.freedesktop.Notifications'
            )
            self._jeepney = jeepney
            self._available = True

        except ImportError as e:
            logger.debug(f"jeepney 导入失败: {e}")

    @property
    def is_available(self) -> bool:
        return self._available

    def notify(self, title: str, body: str, on_success: bool) -> bool:
        if not self._available or not self._conn:
            return False

        try:
            icon_str = str(self._icon_path) if self._icon_path else "dialog-information"

            reply = self._conn.send_and_get_reply(self._jeepney.new_method_call(
                self._notify_addr, 'Notify',
                'susssasa{sv}i',
                (
                    'HComic Downloader',
                    0,
                    icon_str,
                    title,
                    body,
                    ['open', '打开应用'],
                    {},
                    -1
                )
            ))
            self._notification_id = reply.body[0]

            # 启动监听线程
            self._start_listener()

            return True

        except Exception as e:
            logger.error(f"jeepney 通知失败: {e}")
            return False

    def _start_listener(self):
        """启动 ActionInvoked 信号监听"""
        if self._listener_thread and self._listener_thread.is_alive():
            return

        import threading

        def _listen():
            try:
                match = self._jeepney.MatchRule(
                    type='signal',
                    interface='org.freedesktop.Notifications',
                    member='ActionInvoked'
                )
                self._conn.add_match_rule(match)

                while True:
                    msg = self._conn.receive(timeout=1)
                    if msg and hasattr(msg, 'header') and msg.header.message_type == 1:
                        if msg.header.fields.get(4) == 'ActionInvoked':
                            nid, action_key = msg.body
                            if action_key == 'open' and nid == self._notification_id:
                                # 需要在主线程中调用
                                logger.info("通知被点击，激活窗口")
                                break
            except Exception as e:
                logger.debug(f"监听线程退出: {e}")

        self._listener_thread = threading.Thread(target=_listen, daemon=True)
        self._listener_thread.start()


class _LinuxNotifySend:
    """Linux notify-send 实现 (fallback)"""

    def __init__(self, icon_path: Optional[Path]):
        self._icon_path = icon_path
        self._has_wmctrl = self._check_tool("wmctrl")
        self._has_xdotool = self._check_tool("xdotool")

        if not self._has_wmctrl and not self._has_xdotool:
            logger.warning("wmctrl 和 xdotool 都不可用，点击通知后无法激活窗口")

    @staticmethod
    def _check_tool(name: str) -> bool:
        """检测工具是否存在"""
        try:
            subprocess.run(
                ["which", name],
                capture_output=True, check=True
            )
            return True
        except (subprocess.CalledProcessError, FileNotFoundError):
            return False

    def notify(self, title: str, body: str, on_success: bool) -> bool:
        cmd = ["notify-send"]

        if self._icon_path:
            cmd.extend(["-i", str(self._icon_path)])

        cmd.extend(["-u", "normal" if on_success else "critical"])
        cmd.extend([title, body])

        try:
            subprocess.run(cmd, capture_output=True, timeout=5, check=True)
            return True
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
            logger.error(f"notify-send 失败: {e}")
            return False
