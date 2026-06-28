"""Guard: _get_config_path() must never resolve to the real HOME dir during tests.

Protects against regression of the autouse `_isolate_config_dir` fixture in
conftest.py (and the HCOMIC_CONFIG_DIR override in ipc/types.py). If that
fixture is removed/broken, _get_config_path() would resolve to the real
~/.hcomic_downloader/config.json and tests would clobber the user's config —
silently wiping all source_auth cookies and credentials, exactly the bug
this guard exists to prevent.

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


def test_env_var_override_takes_effect():
    """HCOMIC_CONFIG_DIR must redirect _get_config_path() when set.

    Independent of the autouse fixture (which may set it): directly setting
    the var must win over the HOME fallback. Guards the production code path
    in ipc/types.py against being reverted to the hardcoded HOME.
    """
    saved = os.environ.get("HCOMIC_CONFIG_DIR")
    try:
        os.environ["HCOMIC_CONFIG_DIR"] = os.path.join(os.sep, "tmp", "hcomic_guard_probe")
        expected = os.path.normpath(os.path.join(os.environ["HCOMIC_CONFIG_DIR"], "config.json"))
        assert os.path.normpath(types._get_config_path()) == expected
    finally:
        if saved is None:
            os.environ.pop("HCOMIC_CONFIG_DIR", None)
        else:
            os.environ["HCOMIC_CONFIG_DIR"] = saved
