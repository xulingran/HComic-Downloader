"""Guard: application data paths must never resolve to real HOME during tests.

Protects against regression of the autouse `_isolate_config_dir` fixture in
conftest.py and the HCOMIC_CONFIG_DIR overrides. If that fixture is
removed/broken, tests could clobber the user's config.json or library.db.

The guard works because it depends on the autouse fixture being active: with
it, HCOMIC_CONFIG_DIR redirects every binding to tmp_path; without it, the
assertion fails loudly.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(
    0,
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"),
)

import python.ipc_server  # noqa: E402,F401  # ensure the re-exported binding exists
from library_db import get_default_library_db_path  # noqa: E402
from python.ipc import auth_mixin, config_mixin, migration_mixin, types  # noqa: E402

# Modules that bind _get_config_path via `from .types import _get_config_path`
# (local import-time bindings) plus the source definition and the ipc_server
# re-export. Each must resolve away from the real HOME when isolated.
_MODULES_WITH_BINDING = [types, auth_mixin, config_mixin, migration_mixin, python.ipc_server]


def test_config_path_bindings_redirect_away_from_real_home():
    """Every _get_config_path() binding must not point at the real HOME config.

    When the autouse _isolate_config_dir fixture is active, HCOMIC_CONFIG_DIR
    redirects all bindings to tmp_path. If the fixture, the env override, or a
    new mixin binding is broken, this assertion fails before any handler test
    can clobber the real config.json.
    """
    real_path = os.path.normpath(os.path.join(os.path.expanduser("~"), ".hcomic_downloader", "config.json"))
    for module in _MODULES_WITH_BINDING:
        resolved = os.path.normpath(module._get_config_path())
        assert resolved != real_path, (
            f"{module.__name__}._get_config_path() resolved to the real HOME config "
            f"({resolved}); the autouse _isolate_config_dir fixture or the "
            "HCOMIC_CONFIG_DIR override in ipc/types.py is broken — tests would "
            "clobber the real config.json"
        )


def test_library_db_path_redirects_away_from_real_home(tmp_path):
    """The autouse fixture must protect future unpatched IPCServer helpers."""
    real_path = os.path.normpath(os.path.join(os.path.expanduser("~"), ".hcomic_downloader", "library.db"))
    resolved = os.path.normpath(get_default_library_db_path())

    assert resolved != real_path
    assert resolved == os.path.normpath(str(tmp_path / ".hcomic_downloader" / "library.db"))


def test_env_var_override_takes_effect(monkeypatch, tmp_path):
    """HCOMIC_CONFIG_DIR must redirect config.json and library.db together.

    Independent of the autouse fixture (which may set it): directly setting
    the var must win over the HOME fallback. Guards the production code path
    in ipc/types.py against being reverted to the hardcoded HOME.
    """
    probe_dir = tmp_path / "hcomic_guard_probe"
    monkeypatch.setenv("HCOMIC_CONFIG_DIR", str(probe_dir))

    assert os.path.normpath(types._get_config_path()) == os.path.normpath(str(probe_dir / "config.json"))
    assert os.path.normpath(get_default_library_db_path()) == os.path.normpath(str(probe_dir / "library.db"))
