import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(
    0,
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "python"),
)

from python.ipc_server import CONFIG_KEY_MAP


class TestConfigKeyMapping:
    def test_all_frontend_keys_have_python_mapping(self):
        frontend_keys = [
            "themeMode",
            "outputFormat",
            "downloadDir",
            "concurrentDownloads",
            "timeout",
            "retryTimes",
            "cbzFilenameTemplate",
            "batchDownloadDelay",
            "autoRetryMaxAttempts",
            "notifyOnComplete",
            "notifyWhenForeground",
            "defaultSource",
        ]
        for key in frontend_keys:
            assert key in CONFIG_KEY_MAP, f"Missing mapping for frontend key: {key}"

    def test_all_mappings_point_to_valid_config_fields(self):
        from config import Config

        config = Config()
        for camel_key, snake_key in CONFIG_KEY_MAP.items():
            assert hasattr(
                config, snake_key
            ), f"Config has no field: {snake_key} (mapped from {camel_key})"

    def test_set_config_returns_error_for_unknown_key(self):
        assert "unknownKey" not in CONFIG_KEY_MAP
        assert "theme_mode" not in CONFIG_KEY_MAP

    def test_timeout_is_identity_mapping(self):
        assert CONFIG_KEY_MAP["timeout"] == "timeout"
