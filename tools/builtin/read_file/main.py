"""
read_file 工具 — 读取文件内容，支持 offset/limit 行范围。
从 stdin 读取 JSON: {"filePath": "...", "offset": 可选, "limit": 可选}
"""
import json
import sys
import os


def main():
    try:
        raw = sys.stdin.read()
        args = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"参数解析失败: {e}", file=sys.stderr)
        sys.exit(1)

    file_path = args.get("filePath", "")
    offset = args.get("offset")
    limit = args.get("limit")

    # 处理相对路径（workspace root 由调用方传入，如果有的话）
    # 注：当前 ToolLoader 只传 args JSON，workspaceRoot 在 context 中但脚本 stdin 拿不到。
    # 对于绝对路径直接使用；如果是相对路径，由 LLM 确保传入绝对路径。
    if not os.path.isabs(file_path):
        print(f"错误: 请使用绝对路径，收到: {file_path}")
        sys.exit(1)

    if not os.path.isfile(file_path):
        print(f"错误: 文件不存在: {file_path}")
        sys.exit(1)

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
    except Exception as e:
        print(f"读取文件失败: {file_path}\n{type(e).__name__}: {e}")
        sys.exit(1)

    if offset is not None or limit is not None:
        lines = content.split("\n")
        start = offset or 0
        end = (start + limit) if limit else None
        content = "\n".join(lines[start:end])

    sys.stdout.write(content)


if __name__ == "__main__":
    main()
