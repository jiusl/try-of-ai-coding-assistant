"""
edit_file 工具 — 替换文件中的第一个 oldString 为 newString。
从 stdin 读取 JSON: {"filePath": "...", "oldString": "...", "newString": "..."}
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
    old_string = args.get("oldString", "")
    new_string = args.get("newString", "")

    if not file_path:
        print("错误: filePath 不能为空")
        sys.exit(1)

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

    # 查找 oldString（必须恰好出现一次）
    count = content.count(old_string)
    if count == 0:
        print(f"文件中未找到指定内容: {repr(old_string)}")
        sys.exit(1)
    if count > 1:
        print(f"oldString 在文件中出现了 {count} 次，请提供更精确的上下文以确保唯一匹配")
        sys.exit(1)

    new_content = content.replace(old_string, new_string, 1)

    try:
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(new_content)
    except Exception as e:
        print(f"写入文件失败: {file_path}\n{type(e).__name__}: {e}")
        sys.exit(1)

    old_preview = old_string[:80] + ("..." if len(old_string) > 80 else "")
    new_preview = new_string[:80] + ("..." if len(new_string) > 80 else "")
    print(f'成功编辑 {file_path}（将 "{old_preview}" 替换为 "{new_preview}"）')


if __name__ == "__main__":
    main()
