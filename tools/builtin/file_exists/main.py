"""
file_exists 工具 — 检查文件或目录是否存在。
从 stdin 读取 JSON: {"path": "..."}
"""
import json
import sys
import os


def main():
    try:
        raw = sys.stdin.read()
        args = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"exists": False, "error": f"参数解析失败: {e}"}))
        sys.exit(1)

    check_path = args.get("path", "")

    if not check_path:
        print(json.dumps({"exists": False, "isFile": False, "isDirectory": False, "error": "path 不能为空"}))
        sys.exit(1)

    if not os.path.isabs(check_path):
        print(json.dumps({"exists": False, "isFile": False, "isDirectory": False, "error": f"请使用绝对路径: {check_path}"}))
        sys.exit(1)

    try:
        if os.path.isfile(check_path):
            print(json.dumps({"exists": True, "isFile": True, "isDirectory": False}))
        elif os.path.isdir(check_path):
            print(json.dumps({"exists": True, "isFile": False, "isDirectory": True}))
        else:
            print(json.dumps({"exists": False, "isFile": False, "isDirectory": False}))
    except Exception as e:
        print(json.dumps({"exists": False, "isFile": False, "isDirectory": False, "error": str(e)}))


if __name__ == "__main__":
    main()
