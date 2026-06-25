---
name: write_file
description: Write content to a file. Supports absolute paths and relative paths. Creates parent directories if needed.
version: 1.0.0
author: builtin
tags: [file, write, io]
category: file
permission: write
sensitivity: medium
sideEffect: write
safeToRetry: false
defaultEnabled: true
execution:
  type: internal
  impl: write_file
parameters:
  filePath:
    type: string
    description: Absolute or workspace-relative path to write to
    required: true
  content:
    type: string
    description: The full text content to write
    required: true
---
Writes content to a file, creating parent directories as needed.
