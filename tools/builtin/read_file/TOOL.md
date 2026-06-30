---
name: read_file
description: Read the contents of a file. Supports absolute paths (e.g. D:/projects/main.ts) and relative paths from workspace.
version: 1.0.0
author: builtin
tags: [file, read, io]
category: file
permission: read
sensitivity: low
sideEffect: read
safeToRetry: true
defaultEnabled: true
execution:
  type: script
  entry: main.py
parameters:
  filePath:
    type: string
    description: Absolute or workspace-relative file path
    required: true
  offset:
    type: integer
    description: Starting line number (0-based)
    required: false
  limit:
    type: integer
    description: Maximum number of lines to read
    required: false
---
Reads a file from disk. Supports line offset and limit for large files.
