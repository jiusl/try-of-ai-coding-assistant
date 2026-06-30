"""
grep 工具 — 在文件内容中搜索正则表达式。
从 stdin 读取 JSON: {"pattern": "...", "path": "可选", "recursive": bool, "ignoreCase": bool}
"""
import json
import sys
import os
import re
import fnmatch
from pathlib import Path


def find_files_in_dir(directory: str, recursive: bool) -> list[str]:
    """收集目录下的所有文件路径（返回绝对路径）。"""
    files = []
    base = Path(directory)
    if recursive:
        for entry in base.rglob("*"):
            if entry.is_file() and not any(p.startswith(".") for p in entry.parts):
                files.append(str(entry))
    else:
        for entry in base.iterdir():
            if entry.is_file() and not entry.name.startswith("."):
                files.append(str(entry))
    return files


def find_files_by_glob(workspace: str, glob_pattern: str) -> list[str]:
    """按 glob 模式在工作区中查找文件。"""
    results = []
    base = Path(workspace)
    for entry in base.rglob("*"):
        if entry.is_file() and not any(p.startswith(".") for p in entry.parts):
            rel_path = str(entry.relative_to(base)).replace("\\", "/")
            if fnmatch.fnmatch(rel_path, glob_pattern):
                results.append(str(entry))
    return results


def find_workspace_root() -> str:
    """从当前脚本位置向上查找工作区根目录。"""
    current = os.path.dirname(os.path.abspath(__file__))
    for _ in range(6):
        # 检查是否存在 package.json 或 try.json 或 try.db
        for marker in ("package.json", "try.json", "try.db"):
            if os.path.isfile(os.path.join(current, marker)):
                return current
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    return os.getcwd()


def is_text_file(filepath: str) -> bool:
    """快速检测文件是否为文本（非二进制）。"""
    try:
        with open(filepath, "rb") as f:
            chunk = f.read(1024)
        # 二进制文件通常包含 null 字节
        return b"\x00" not in chunk
    except Exception:
        return False


def main():
    try:
        raw = sys.stdin.read()
        args = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"参数解析失败: {e}", file=sys.stderr)
        sys.exit(1)

    pattern = args.get("pattern", "")
    search_path = args.get("path")
    recursive = args.get("recursive", False)
    ignore_case = args.get("ignoreCase", False)

    if not pattern:
        print("错误: pattern 不能为空")
        sys.exit(1)

    # 编译正则
    flags = re.IGNORECASE if ignore_case else 0
    try:
        regex = re.compile(pattern, flags)
    except re.error as e:
        print(f"无效的正则表达式: {pattern}\n{e}")
        sys.exit(1)

    # 确定搜索根目录和文件查找策略
    workspace = find_workspace_root()

    if search_path:
        abs_path = search_path if os.path.isabs(search_path) else os.path.join(workspace, search_path)
        if os.path.isdir(abs_path):
            # 目录 → 在目录内搜索
            all_files = find_files_in_dir(abs_path, recursive)
        elif os.path.isfile(abs_path):
            # 单个文件
            all_files = [abs_path]
        else:
            # glob 模式
            all_files = find_files_by_glob(workspace, search_path)
    else:
        # 无 path → 工作区全部文件
        all_files = find_files_by_glob(workspace, "**/*") if recursive else []

    # 过滤二进制文件
    text_files = [f for f in all_files if is_text_file(f)]

    # 搜索（最多 50 个文件，100 条结果）
    results = []
    for filepath in text_files[:50]:
        try:
            with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
        except Exception:
            continue

        # 使用工作区相对路径
        rel = filepath.replace("\\", "/")
        ws_slash = workspace.replace("\\", "/") + "/"
        if rel.startswith(ws_slash):
            rel = rel[len(ws_slash):]

        for i, line in enumerate(lines):
            if regex.search(line):
                results.append({
                    "file": rel,
                    "line": i + 1,
                    "content": line.strip()
                })
                if len(results) >= 100:
                    break
        if len(results) >= 100:
            break

    if not results:
        print(f"未找到匹配 '{pattern}' 的内容")
        return

    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
