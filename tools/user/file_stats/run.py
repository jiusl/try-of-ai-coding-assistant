#!/usr/bin/env python3
"""file_stats tool — reads JSON input from stdin, returns file statistics."""
import sys
import json
import os

def main():
    try:
        raw = sys.stdin.read()
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON input: {e}")
        sys.exit(1)

    file_path = data.get("filePath", "")
    output_format = data.get("format", "text")

    if not file_path:
        print("Error: filePath is required")
        sys.exit(1)

    if not os.path.exists(file_path):
        print(f"Error: File not found: {file_path}")
        sys.exit(1)

    if not os.path.isfile(file_path):
        print(f"Error: Not a file: {file_path}")
        sys.exit(1)

    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        sys.exit(1)

    file_size = os.path.getsize(file_path)
    lines = content.count("\n") + (1 if content and not content.endswith("\n") else 0)
    words = len(content.split())
    chars = len(content)

    if output_format == "json":
        result = {
            "filePath": file_path,
            "fileSizeBytes": file_size,
            "lines": lines,
            "words": words,
            "characters": chars,
        }
        print(json.dumps(result, indent=2))
    else:
        print(f"📄 File: {file_path}")
        print(f"   Size:     {file_size:,} bytes")
        print(f"   Lines:    {lines:,}")
        print(f"   Words:    {words:,}")
        print(f"   Chars:    {chars:,}")

if __name__ == "__main__":
    main()
