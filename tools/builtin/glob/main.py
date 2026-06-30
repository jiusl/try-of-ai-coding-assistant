"""
glob 工具 — 按 glob 模式查找文件。
从 stdin 读取 JSON: {"pattern": "...", "cwd": "可选", "ignore": [...]}
"""
import json
import sys
import os
import fnmatch
from pathlib import Path


def glob_search(pattern: str, cwd: str, ignore_patterns: list[str] | None = None) -> list[str]:
    """递归查找匹配 glob 模式的文件，跳过隐藏文件和 ignore 模式。"""
    ignore_set = set(ignore_patterns or [])
    results = []
    base = Path(cwd)

    for entry in base.rglob("*"):
        if entry.is_dir():
            continue
        # 跳过隐藏文件/目录
        if any(part.startswith(".") for part in entry.parts):
            continue

        rel_path = str(entry.relative_to(base)).replace("\\", "/")

        # 检查 ignore 模式
        if any(fnmatch.fnmatch(rel_path, p) for p in ignore_set):
            continue

        # 检查匹配模式
        if fnmatch.fnmatch(rel_path, pattern):
            results.append(rel_path)

    return sorted(results)


def main():
    try:
        raw = sys.stdin.read()
        args = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"参数解析失败: {e}", file=sys.stderr)
        sys.exit(1)

    pattern = args.get("pattern", "*")
    cwd = args.get("cwd") or os.getcwd()
    ignore_list = args.get("ignore")

    if not os.path.isabs(cwd):
        print(f"错误: cwd 必须是绝对路径: {cwd}")
        sys.exit(1)

    if not os.path.isdir(cwd):
        print(f"错误: 目录不存在: {cwd}")
        sys.exit(1)

    try:
        files = glob_search(pattern, cwd, ignore_list)
    except Exception as e:
        print(f"文件搜索失败: {pattern}\n{type(e).__name__}: {e}")
        sys.exit(1)

    if not files:
        print(f"未找到匹配 '{pattern}' 的文件")
        return

    print("\n".join(files))


if __name__ == "__main__":
    main()
