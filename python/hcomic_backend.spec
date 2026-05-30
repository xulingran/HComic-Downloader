# -*- mode: python ; coding: utf-8 -*-
import os
import platform

# UPX is unavailable on macOS ARM64; disable to prevent build failures
_use_upx = not (platform.system() == 'Darwin' and platform.machine() == 'arm64')

SPEC_DIR = os.path.abspath(SPECPATH)
PROJECT_ROOT = os.path.dirname(SPEC_DIR)

a = Analysis(
    [os.path.join(SPEC_DIR, 'ipc_server.py')],
    pathex=[PROJECT_ROOT, SPEC_DIR],
    binaries=[],
    datas=[],
    hiddenimports=[
        'parser',
        'downloader',
        'config',
        'models',
        'auth_parser',
        'download_manager',
        'cbz_builder',
        'constants',
        'utils',
        'image_formats',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tests', 'pytest'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='python',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=_use_upx,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=_use_upx,
    upx_exclude=[],
    name='python',
)
