"""Python 测试质量闸门的自我验证测试（test-quality-gate 规范 / 决策 5）。

复用 test_config_isolation_guard.py 的守卫模式：闸门规则是"测试的测试"，
其自身必须有测试覆盖，否则规则演进（如调整 AST 匹配）会静默失效。

把 scripts/lint-test-quality.py 的 scan_source 当作被测函数，
喂入合成 test_* 函数源码字符串，断言反例被报告、正例被放行。
"""

from __future__ import annotations

import importlib.util
import os
import sys

import pytest

# scripts/lint-test-quality.py 不在包内，需按文件路径加载为模块
_SCRIPT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "scripts",
    "lint-test-quality.py",
)
_spec = importlib.util.spec_from_file_location("lint_test_quality", _SCRIPT_PATH)
assert _spec is not None and _spec.loader is not None
_mod = importlib.util.module_from_spec(_spec)
# 必须先注册到 sys.modules 再 exec：dataclass 装饰器在解析 cls.__module__ 时
# 会查 sys.modules，未注册会触发 AttributeError（NoneType.__dict__）。
sys.modules["lint_test_quality"] = _mod
_spec.loader.exec_module(_mod)
scan_source = _mod.scan_source


# ── 反例（应被报告）────────────────────────────────────────────────


def test_bare_assert_called_reported():
    """仅 assert mock.assert_called() 无真实断言 → 报告。"""
    code = """
def test_bare():
    m = Mock()
    m()
    m.assert_called()
"""
    violations = scan_source(code, filename="fake_test.py")
    assert len(violations) == 1, f"应报告 1 处，实际 {len(violations)}"
    assert violations[0].function == "test_bare"
    assert "assert_called" in violations[0].mock_methods


def test_assert_called_once_passes():
    """assert_called_once() 断言"恰好一次"，承载信号 → 放行（Phase A 精炼）。

    与前端 toHaveBeenCalledTimes(1) 对齐：mock 替换测试不成立（次数由被测代码决定）。
    """
    code = """
def test_once():
    m = Mock()
    m()
    m.assert_called_once()
"""
    assert scan_source(code) == []


def test_assert_not_called_passes():
    """assert_not_called() 断言"未触发"，承载 cancel/守卫信号 → 放行（Phase A 精炼）。"""
    code = """
def test_not_called():
    m = Mock()
    m.assert_not_called()
"""
    assert scan_source(code) == []


def test_bare_assert_called_with_literal_passes():
    """assert_called_with(...) → 放行（参数承载"以何参数调用"的契约信号）。

    精炼后（Phase A）：assert_called_with/once_with 一律放行，与前端 toHaveBeenCalledWith
    对齐。实际测试中参数几乎总是验证被测代码构建的 URL/JSON/标志位（mock 替换测试不成立）。
    """
    code = """
def test_bare():
    m = Mock()
    m(1, 2)
    m.assert_called_with(1, 2)
"""
    assert scan_source(code) == []


def test_assert_called_once_with_passes():
    """assert_called_once_with(...) → 放行（"恰好一次 + 参数契约"，承载双重信号）。"""
    code = """
def test_bare():
    m = Mock()
    m(1)
    m.assert_called_once_with(1)
"""
    assert scan_source(code) == []


def test_assert_any_call_reported():
    """assert_any_call(...) 仍拦截（调用历史检查，不承载"恰好一次"不变量）。"""
    code = """
def test_bare():
    m = Mock()
    m(1)
    m.assert_any_call(1)
"""
    violations = scan_source(code)
    assert len(violations) == 1


def test_multiple_mock_assertions_in_one_function_reported_once():
    """同一函数内多个裸 mock 调用断言合并为一条违规。

    注：assert_called_once/once_with/not_called 精炼后放行，故本用例只收集裸调用家族。
    """
    code = """
def test_multi():
    m = Mock()
    m()
    m.assert_called()
    m.assert_any_call('x')
"""
    violations = scan_source(code)
    assert len(violations) == 1
    assert len(violations[0].mock_methods) == 2


# ── 正例（应被放行）────────────────────────────────────────────────


def test_comparison_assertion_passes():
    """含 assert a == b 比较断言 → 放行。"""
    code = """
def test_with_comparison():
    m = Mock()
    m()
    m.assert_called()
    result = compute()
    assert result == 42
"""
    assert scan_source(code) == []


def test_state_attribute_assertion_passes():
    """含 assert obj.attr 状态断言 → 放行。"""
    code = """
def test_with_state():
    mixin._migration_paused_dm = True
    mixin.handle_cancel()
    m = Mock()
    m.assert_called()
    assert mixin._migration_paused_dm is False
"""
    assert scan_source(code) == []


def test_subscript_assertion_passes():
    """含 assert obj[key] 下标断言 → 放行。"""
    code = """
def test_with_subscript():
    dm.tasks['id'].status = 'done'
    m = Mock()
    m.assert_called()
    assert dm.tasks['id'].status == 'done'
"""
    assert scan_source(code) == []


def test_pytest_raises_passes():
    """含 pytest.raises 异常断言 → 放行。"""
    code = """
def test_with_raises():
    m = Mock()
    m.assert_called()
    with pytest.raises(ValueError):
        risky_call()
"""
    assert scan_source(code) == []


def test_except_handler_passes():
    """含 except 分支（副作用观察）→ 放行。"""
    code = """
def test_with_except():
    m = Mock()
    m.assert_called()
    try:
        risky_call()
    except ValueError:
        pass
"""
    assert scan_source(code) == []


def test_non_test_function_not_scanned():
    """非 test_ 前缀的函数不被扫描。"""
    code = """
def helper():
    m = Mock()
    m()
    m.assert_called()
"""
    assert scan_source(code) == []


def test_no_mock_assertions_passes():
    """无任何 mock 调用断言 → 放行。"""
    code = """
def test_normal():
    result = compute()
    assert result == 42
"""
    assert scan_source(code) == []


def test_syntax_error_file_skipped():
    """语法错误的源码跳过（交给 ruff/python 处理），返回空列表。"""
    code = "def test_x(:\n    pass"
    assert scan_source(code) == []


# ── 真实迁移测试用例的回归（确认清理后的测试不再被报）──────────────────


def test_migration_mixin_cleaned_tests_pass_gate():
    """Phase 1 清理后的 test_migration_mixin.py 不应被闸门报告。"""
    test_file = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "tests",
        "test_migration_mixin.py",
    )
    if not os.path.exists(test_file):
        pytest.skip("test_migration_mixin.py 不存在")
    with open(test_file, encoding="utf-8") as f:
        source = f.read()
    violations = scan_source(source, filename="test_migration_mixin.py")
    # Phase 1 已删除所有裸 mock 调用断言；剩余用例均伴随 _migration_paused_dm 状态断言
    assert violations == [], f"清理后仍被报告：{[v.function for v in violations]}"
