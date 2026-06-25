---
name: file_stats
description: Get statistics about a file (line count, word count, character count, file size)
version: 1.0.0
author: user
tags: [file, stats, analysis]
category: file
permission: read
sensitivity: low
sideEffect: read
safeToRetry: true
defaultEnabled: true
execution:
  entry: run.py
  timeout: 10000
  requireConfirm: false
parameters:
  filePath:
    type: string
    description: Absolute or relative path to the file to analyze
    required: true
  format:
    type: string
    description: Output format (text or json)
    required: false
    default: text
    enum: [text, json]
---

Analyzes a file and returns line count, word count, character count, and file size.
Useful for quick codebase metrics.
