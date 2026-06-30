---
name: glob
description: Find files matching a glob pattern (e.g., '**/*.ts'). Supports absolute paths for cwd.
version: 1.0.0
author: builtin
tags: [file, search, glob]
category: search
permission: read
sensitivity: low
sideEffect: read
safeToRetry: true
defaultEnabled: true
execution:
  type: script
  entry: main.py
parameters:
  pattern:
    type: string
    description: Glob pattern like '**/*.ts', 'src/**/*.test.ts'
    required: true
  cwd:
    type: string
    description: Search root directory (default: workspace root)
    required: false
  ignore:
    type: array
    description: Array of glob patterns to exclude
    required: false
    items:
      type: string
---
Finds files by glob pattern using micromatch.
