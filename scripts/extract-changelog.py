"""从 CHANGELOG.md 提取指定版本的发布说明，供 GitHub Release 使用。

在 release.yml 的 release job 中调用：根据当前 tag（如 1.7.0）从仓库根目录的
CHANGELOG.md 中提取对应 ``## [x.y.z] - YYYY-MM-DD`` 段落，写入 ``RELEASE_NOTES.md``。
随后由 ``softprops/action-gh-release`` 的 ``body_file`` 读取，替代
``generate_release_notes: true``（后者只会生成一行 commit 对比链接，不会读 CHANGELOG）。

判定与回退策略：
    - tag 命中且 CHANGELOG.md 存在该段落 → 写入该段落正文
    - tag 命中但 CHANGELOG.md 无此段落 → 写入一行提示并回退到自动生成
    - 无 tag（本地直接运行）→ 仅报错退出，不影响 CI

CHANGELOG.md 需遵循 Keep a Changelog 格式，版本段落形如：
    ## [1.7.0] - 2026-06-30
    ...正文...
    ## [1.6.0] - 2026-06-24

用法：
    python scripts/extract-changelog.py [--version 1.7.0] [--changelog CHANGELOG.md] [--out RELEASE_NOTES.md]
        默认 --version 取最近 git tag（去 v 前缀）
        默认 --changelog 为仓库根 CHANGELOG.md
        默认 --out 为当前目录 RELEASE_NOTES.md

退出码：
    0  成功写入，或命中回退路径（仍产出可用的 RELEASE_NOTES.md）
    1  无 tag / CHANGELOG.md 缺失且无 tag（阻断 release job，避免空正文发布）
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

# 仓库根目录（脚本位于 scripts/ 下）。
REPO_ROOT = Path(__file__).resolve().parent.parent

# 版本段落起始行：## [1.7.0] - 2026-06-30（Keep a Changelog 标准格式）。
# 同时兼容无日期写法：## [1.7.0]、## [Unreleased]。
SECTION_HEADER_RE = re.compile(r"^##\s*\[([^\]]+)\]")

# SemVer 正则（去 v 前缀后），用于校验 tag。
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")


def detect_version_from_tag() -> str | None:
    """从最近的 git tag 推断版本号（去 v 前缀）。

    Returns:
        形如 "1.7.0" 的版本字符串；无 tag 或非 CI 环境运行失败时返回 None。
    """
    try:
        tag = subprocess.run(
            ["git", "describe", "--tags", "--abbrev=0"],
            capture_output=True,
            text=True,
            check=True,
            cwd=REPO_ROOT,
        ).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None

    return tag.lstrip("v") or None


def extract_section(changelog_text: str, version: str) -> str | None:
    """从 CHANGELOG 全文中提取指定版本的段落正文。

    段落边界为下一个 ``## [`` 开头的标题（或文件结尾）。提取的内容**不含**
    段落标题行本身，避免与 Release 标题（已是版本号）重复。

    Args:
        changelog_text: CHANGELOG.md 的完整文本。
        version: 目标版本号，如 "1.7.0"。

    Returns:
        该段落的正文（已去除首尾空白）；未找到时返回 None。
    """
    lines = changelog_text.splitlines()
    target = f"[{version}]"
    start_idx: int | None = None

    for idx, line in enumerate(lines):
        match = SECTION_HEADER_RE.match(line)
        if match and f"[{match.group(1)}]" == target:
            start_idx = idx
            break

    if start_idx is None:
        return None

    # 从段落标题下一行开始，搜集到下一个 ## [ 标题为止。
    body_lines: list[str] = []
    for line in lines[start_idx + 1 :]:
        if SECTION_HEADER_RE.match(line):
            break
        body_lines.append(line)

    return "\n".join(body_lines).strip() or None


def main() -> int:
    parser = argparse.ArgumentParser(description="从 CHANGELOG.md 提取指定版本的发布说明")
    parser.add_argument(
        "--version",
        default=None,
        help="目标版本号（如 1.7.0）；默认取最近 git tag（去 v 前缀）",
    )
    parser.add_argument(
        "--changelog",
        default=str(REPO_ROOT / "CHANGELOG.md"),
        help="CHANGELOG.md 路径（默认仓库根 CHANGELOG.md）",
    )
    parser.add_argument(
        "--out",
        default="RELEASE_NOTES.md",
        help="输出文件路径（默认当前目录 RELEASE_NOTES.md）",
    )
    args = parser.parse_args()

    # 1. 确定版本号：显式参数 > git tag > 报错。
    version = args.version or detect_version_from_tag()
    if not version:
        print("[extract-changelog] 错误：未提供 --version 且未找到 git tag", file=sys.stderr)
        return 1
    if not SEMVER_RE.match(version):
        print(f"[extract-changelog] 错误：版本号『{version}』不是有效的 semver 格式", file=sys.stderr)
        return 1

    changelog_path = Path(args.changelog)
    if not changelog_path.is_file():
        print(f"[extract-changelog] 错误：CHANGELOG.md 不存在：{changelog_path}", file=sys.stderr)
        return 1

    changelog_text = changelog_path.read_text(encoding="utf-8")
    body = extract_section(changelog_text, version)

    out_path = Path(args.out)
    if body:
        # 命中：写入 CHANGELOG 段落正文。commit 对比链接由 action-gh-release
        # 自动追加（保留 generate_release_notes 不可时由 body 替代）。
        out_path.write_text(body + "\n", encoding="utf-8")
        print(f"[extract-changelog] 已提取 {version} 的发布说明 → {out_path}（{len(body)} 字符）")
        return 0
    else:
        # 回退：CHANGELOG 无此段落，写入提示。release.yml 此时回落到
        # generate_release_notes 自动生成（见 workflow 中的 fallback 条件）。
        fallback = "详见 [CHANGELOG.md](./CHANGELOG.md)。\n"
        out_path.write_text(fallback, encoding="utf-8")
        print(
            f"[extract-changelog] 警告：CHANGELOG.md 中未找到 [{version}] 段落，" f"已写入回退文本 → {out_path}",
            file=sys.stderr,
        )
        return 0


if __name__ == "__main__":
    sys.exit(main())
