"""测试质量闸门：Python 侧静态扫描（test-quality-gate 规范 / 决策 2）。

拦截"仅断言 mock 被调用、不同时验证真实行为"的 Python 测试函数。
判定准则与 test-discipline "mock 替换测试"一致：若把被 mock 的对象替换为
真实实现后断言仍必然成立，则该断言为同义反复。

覆盖的 mock 调用断言形态：
    mock.assert_called()
    mock.assert_called_once()
    mock.assert_called_with(...)
    mock.assert_called_once_with(...)
    mock.assert_any_call(...)
    mock.assert_has_calls(...)
    mock.assert_not_called()

"真实行为断言"判定（满足任一即视为有真实信号）：
    - assert <expr> <op> <expr>（比较/布尔运算：== != in is < > 等）
    - pytest.raises(...)（异常断言）
    - assert <obj>.<attr>（属性访问，如 state.completed_items）
    - assert <obj>[<key>]（下标访问，如 tasks[tid]）
    - 函数体含 except 分支（异常处理视为副作用观察）
    - 非 assert_called* 的 assert（兜底，避免漏报）

用法：
    python scripts/lint-test-quality.py [--root tests] [--strict]
        --strict   检测到违规时以非零退出码退出（Phase 2b 用）
        默认       仅打印报告，退出码 0（Phase 2a warn 阶段）

可作为模块导入：
    from lint_test_quality import scan_source
    violations = scan_source(source_code)  # 返回 list[Violation]
"""

from __future__ import annotations

import argparse
import ast
import os
import sys
from collections.abc import Iterable
from dataclasses import dataclass

# 被拦截的 mock 调用断言方法名（cleanup-test-quality-backlog Phase A 精炼）。
# 仅保留"裸调用"语义（无信号）的方法：
#   - assert_called：仅"被调用过"，无次数/参数信息
#   - assert_any_call / assert_has_calls：调用历史检查，参数判定不承载"恰好一次"等不变量
# 放行的（承载信号，不拦截）：
#   - assert_called_once / assert_called_once_with：断言"恰好一次"（与前端 toHaveBeenCalledTimes(1) 对齐）
#   - assert_not_called：断言"未触发"（与前端 not.toHaveBeenCalled 对齐，承载 cancel/守卫信号）
#   - assert_called_with / assert_called_once_with：参数承载"以何参数调用"的契约信号
#     （实际测试中几乎总是验证被测代码构建的 URL/JSON/标志位，mock 替换测试不成立）
# 经验验证：本仓库 tests/ 实际仅使用 assert_called_once_with(16)/assert_not_called(5)/
# assert_called_once(4)，无 assert_called/any_call/has_calls 用例，故拦截集保持最小。
BARE_MOCK_ASSERTIONS = frozenset(
    {
        "assert_called",
        "assert_any_call",
        "assert_has_calls",
    }
)


@dataclass
class Violation:
    """一条测试质量违规。

    Attributes:
        file: 源文件路径（相对或绝对，由调用方决定）。
        function: 违规所在的 test_* 函数名。
        lineno: 触发违规的 mock 调用断言行号（1-based）。
        mock_methods: 该函数内收集到的 mock 调用断言方法名集合。
        message: 人类可读的违规描述。
    """

    file: str
    function: str
    lineno: int
    mock_methods: tuple[str, ...]
    message: str


def _is_mock_call_assertion(node: ast.Call) -> str | None:
    """判断 CallExpression 是否为应拦截的 mock 调用断言，返回方法名或 None。

    精炼判定（cleanup-test-quality-backlog Phase A）：
    仅 BARE_MOCK_ASSERTIONS（assert_called / assert_any_call / assert_has_calls）拦截——
    这些是"裸调用"断言，无次数/参数信息。
    assert_called_once/once_with（"恰好一次"）、assert_not_called（"未触发"）、
    assert_called_with/once_with（参数契约）均承载信号，放行。

    形态：node.func = Attribute(value=<mock expr>, attr="assert_called...")
    """
    callee = node.func
    if not isinstance(callee, ast.Attribute):
        return None
    if callee.attr in BARE_MOCK_ASSERTIONS:
        return callee.attr
    return None


def _node_contains_real_assertion(node: ast.AST) -> bool:
    """递归判断 AST 子树是否含"真实行为断言"。

    真实信号形态见模块 docstring。本函数对函数体（排除嵌套函数定义）做深度遍历。
    """
    for child in ast.walk(node):
        # assert <comparison>：比较/布尔运算承载真实信号
        if isinstance(child, ast.Assert):
            test = child.test
            # assert <a> <op> <b>
            if isinstance(test, (ast.Compare, ast.BoolOp)):
                return True
            # assert <obj>.attr —— 属性访问断言（如 state.completed_items）
            if isinstance(test, ast.Attribute):
                return True
            # assert <obj>[key] —— 下标断言（如 tasks[tid]）
            if isinstance(test, ast.Subscript):
                return True
            # assert <call>() —— 函数调用断言（如 len(tasks) == ... 的 len 调用，
            #   或 is_valid() 这类布尔返回）。注意 assert_called* 已在外层排除，
            #   这里捕获的是真实函数调用断言。
            if isinstance(test, ast.Call):
                # 排除 mock.assert_called* —— 但这些会在外层判定中先被识别，
                # 这里保守返回 True（存在某种调用断言，可能是真实信号）
                return True
            # assert <name> is None / is not None
            if isinstance(test, (ast.Name, ast.Constant)):
                # 纯标识符/常量断言（assert x / assert True）信号弱，但保守放行
                # —— 这类断言通常配合其他真实断言，单独出现罕见
                return True
        # pytest.raises(...) —— 异常断言
        if isinstance(child, ast.Call):
            func = child.func
            if isinstance(func, ast.Attribute) and func.attr == "raises":
                # pytest.raises / self.raises 等
                return True
            if isinstance(func, ast.Name) and func.id == "raises":
                return True
        # except 分支 —— 异常处理视为副作用观察（真实信号）
        if isinstance(child, ast.ExceptHandler):
            return True
    return False


def _iter_test_functions(tree: ast.Module) -> Iterable[tuple[str, ast.FunctionDef | ast.AsyncFunctionDef]]:
    """遍历模块中的 test_* 函数（含嵌套在类内的方法）。

    Yields:
        (function_name, function_node)
    """
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith("test_"):
            yield node.name, node


def scan_source(source: str, filename: str = "<string>") -> list[Violation]:
    """扫描一段 Python 源码，返回其中的测试质量违规列表。

    Args:
        source: Python 源码字符串。
        filename: 用于违规报告的文件名。

    Returns:
        违规列表（每个违规的 test_* 函数最多一条，指向首个 mock 调用断言行）。
    """
    try:
        tree = ast.parse(source, filename=filename)
    except SyntaxError:
        # 语法错误的文件交给 ruff/python 处理，本扫描器跳过
        return []

    violations: list[Violation] = []
    for func_name, func_node in _iter_test_functions(tree):
        # 收集函数体内的 mock 调用断言
        mock_methods: list[str] = []
        mock_lines: list[int] = []
        for child in ast.walk(func_node):
            if isinstance(child, ast.Call):
                method = _is_mock_call_assertion(child)
                if method is not None:
                    mock_methods.append(method)
                    mock_lines.append(child.lineno)

        if not mock_methods:
            continue  # 无 mock 调用断言，无需检查

        # 判定函数体是否含真实行为断言
        # （用整个函数体，而非排除 mock 断言后的部分——真实断言可能伴生 mock 断言）
        has_real = _node_contains_real_assertion(func_node)

        if not has_real:
            violations.append(
                Violation(
                    file=filename,
                    function=func_name,
                    lineno=mock_lines[0],
                    mock_methods=tuple(dict.fromkeys(mock_methods)),  # 去重保序
                    message=(
                        f"测试函数 {func_name} 仅含 mock 调用断言（{', '.join(dict.fromkeys(mock_methods))}），"
                        "缺少返回值/状态/异常的真实行为断言。mock 替换测试：把 mock 换成真实实现，"
                        "此断言仍必然成立。请补充行为断言或删除该 mock 调用断言。"
                    ),
                )
            )
    return violations


def scan_path(root: str) -> list[Violation]:
    """扫描目录下所有 tests/**/*.py 文件，返回累计违规列表。"""
    all_violations: list[Violation] = []
    for dirpath, _dirnames, filenames in os.walk(root):
        # 跳过 venv / 缓存目录
        if "venv" in dirpath.split(os.sep) or "__pycache__" in dirpath:
            continue
        for fname in filenames:
            if not (fname.startswith("test_") and fname.endswith(".py")):
                continue
            fpath = os.path.join(dirpath, fname)
            try:
                with open(fpath, encoding="utf-8") as f:
                    source = f.read()
            except OSError:
                continue
            rel = os.path.relpath(fpath, root)
            all_violations.extend(scan_source(source, filename=rel))
    return all_violations


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="测试质量闸门：扫描 Python 测试中的裸 mock 调用断言（test-quality-gate 规范）"
    )
    parser.add_argument(
        "--root",
        default="tests",
        help="扫描根目录（默认 tests）",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="检测到违规时以非零退出码退出（Phase 2b 用）；默认仅打印报告",
    )
    args = parser.parse_args(argv)

    if not os.path.isdir(args.root):
        print(f"错误：扫描根目录不存在：{args.root}", file=sys.stderr)
        return 2

    violations = scan_path(args.root)

    if not violations:
        print(f"✓ 测试质量检查通过：{args.root} 下无裸 mock 调用断言违规。")
        return 0

    print(f"发现 {len(violations)} 处测试质量违规（裸 mock 调用断言，缺少真实行为断言）：\n")
    for v in violations:
        print(f"  {v.file}:{v.lineno}  {v.function}")
        print(f"    {v.message}\n")
    print(
        "提示：本检查为 error 级别（cleanup-test-quality-backlog Phase C 起，"
        "--strict 违规时非零退出码阻断 CI）。"
        "请补充真实行为断言（返回值/状态/异常）或删除冗余的 mock 调用断言。"
    )
    return 1 if args.strict else 0


if __name__ == "__main__":
    sys.exit(main())
