"""
write_file 工具 — 写入内容到文件，自动创建父目录。
从 stdin 读取 JSON: {"filePath": "...", "content": "..."}
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
    content = args.get("content", "")

    if not file_path:
        print("错误: filePath 不能为空")
        sys.exit(1)

    if not os.path.isabs(file_path):
        print(f"错误: 请使用绝对路径，收到: {file_path}")
        sys.exit(1)

    # 确保父目录存在
    parent_dir = os.path.dirname(file_path)
    if parent_dir:
        try:
            os.makedirs(parent_dir, exist_ok=True)
        except Exception as e:
            print(f"创建目录失败: {parent_dir}\n{type(e).__name__}: {e}")
            sys.exit(1)

    try:
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)
    except Exception as e:
        print(f"写入文件失败: {file_path}\n{type(e).__name__}: {e}")
        sys.exit(1)

    print(f"成功写入 {file_path}")


if __name__ == "__main__":
    main()
