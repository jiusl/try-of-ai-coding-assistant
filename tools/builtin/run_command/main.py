"""
run_command 工具 — 执行可能修改系统的 shell 命令。
从 stdin 读取 JSON: {"command": "...", "timeout": 可选, "cwd": 可选}
"""
import json
import sys
import os

# 将 _shared 加入搜索路径以导入 cmd_utils 和 encoding
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_shared"))
import encoding  # noqa: F401 — 强制 stdin/stdout UTF-8
from cmd_utils import execute_command


def main():
    try:
        raw = sys.stdin.read()
        args = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"参数解析失败: {e}", file=sys.stderr)
        sys.exit(1)

    command = args.get("command", "")
    cwd = args.get("cwd") or os.getcwd()
    timeout_ms = args.get("timeout", 30000)

    if not command:
        print("错误: command 不能为空")
        sys.exit(1)

    stdout, stderr, exit_code = execute_command(command, cwd, timeout_ms)

    parts = []
    if stdout:
        parts.append(stdout)
    if stderr:
        parts.append(f"[stderr]\n{stderr}")
    if exit_code != 0:
        parts.append(f"[退出码: {exit_code}]")

    output = "\n".join(parts).strip()
    print(output or "命令执行成功（无输出）")


if __name__ == "__main__":
    main()
