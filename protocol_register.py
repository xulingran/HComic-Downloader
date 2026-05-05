"""Windows URI 协议注册模块"""
from __future__ import annotations

import logging
import platform
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

_IS_WINDOWS = platform.system() == "Windows"
_PROTOCOL_NAME = "hcomic"


def _get_exe_path() -> str:
    """获取当前可执行文件路径"""
    if getattr(sys, 'frozen', False):
        # PyInstaller 打包后
        return str(Path(sys.executable))
    else:
        # 开发环境
        python_exe = sys.executable
        script_path = Path(__file__).parent / "main.py"
        return f'"{python_exe}" "{script_path}"'


def register_protocol() -> tuple[bool, str]:
    """注册 hcomic:// URI 协议

    Returns:
        (成功, 消息)
    """
    if not _IS_WINDOWS:
        return False, "仅支持 Windows 平台"

    try:
        import winreg

        exe_path = _get_exe_path()
        key_path = f"Software\\Classes\\{_PROTOCOL_NAME}"

        # 创建协议键
        key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, key_path)
        winreg.SetValueEx(key, "", 0, winreg.REG_SZ, f"URL:{_PROTOCOL_NAME} Protocol")
        winreg.SetValueEx(key, "URL Protocol", 0, winreg.REG_SZ, "")

        # 设置图标
        icon_key = winreg.CreateKey(key, "DefaultIcon")
        icon_path = Path(__file__).parent / "assets" / "icon_48.png"
        winreg.SetValueEx(icon_key, "", 0, winreg.REG_SZ, f"{icon_path},0")
        winreg.CloseKey(icon_key)

        # 设置命令
        command_key = winreg.CreateKey(key, r"shell\open\command")
        winreg.SetValueEx(command_key, "", 0, winreg.REG_SZ, f'{exe_path} "%1"')
        winreg.CloseKey(command_key)

        winreg.CloseKey(key)

        logger.info(f"协议 {_PROTOCOL_NAME}:// 已注册")
        return True, "协议注册成功"

    except Exception as e:
        logger.error(f"注册协议失败: {e}")
        return False, str(e)


def is_protocol_registered() -> bool:
    """检测 hcomic:// 协议是否已注册

    Returns:
        是否已注册
    """
    if not _IS_WINDOWS:
        return False

    try:
        import winreg

        key_path = f"Software\\Classes\\{_PROTOCOL_NAME}"
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path)
        winreg.CloseKey(key)
        return True

    except FileNotFoundError:
        return False
    except Exception as e:
        logger.error(f"检测协议状态失败: {e}")
        return False


def unregister_protocol() -> tuple[bool, str]:
    """取消注册 hcomic:// URI 协议

    Returns:
        (成功, 消息)
    """
    if not _IS_WINDOWS:
        return False, "仅支持 Windows 平台"

    try:
        import winreg

        key_path = f"Software\\Classes\\{_PROTOCOL_NAME}"
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, key_path)

        logger.info(f"协议 {_PROTOCOL_NAME}:// 已取消注册")
        return True, "协议已取消注册"

    except FileNotFoundError:
        return True, "协议未注册"
    except Exception as e:
        logger.error(f"取消注册协议失败: {e}")
        return False, str(e)
